# Tabs — design

## Goal

Allow Piyo to host multiple shell sessions in one window, switchable via tabs in the titlebar.

- `Cmd+T` opens a new tab.
- `Cmd+W` closes the active tab. Closing the last tab closes the window.
- With one tab, the titlebar shows the current shell title centered (today's behavior, unchanged).
- With two or more tabs, the titlebar shows a row of tabs, each rendering its own title.

## User-visible behavior

| Gesture             | Effect                                                       |
| ------------------- | ------------------------------------------------------------ |
| `Cmd+T`             | Spawn a new tab; cwd inherits the active tab's cwd.          |
| `Cmd+W`             | Close active tab. If it was the last, close the window.      |
| `Cmd+Shift+[` / `]` | Switch to previous / next tab (wraps).                       |
| `Cmd+1` … `Cmd+9`   | Jump to tab N. `Cmd+9` jumps to the last tab.                |
| Click a tab         | Activate that tab.                                           |
| Drag a tab          | Reorder tabs in the strip.                                   |
| Hover a tab         | Reveal close × on that tab (active or not, matches Ghostty). |
| Click ×             | Close that tab.                                              |
| Shell process exits | Tab auto-closes. If it was the last tab, window closes.      |

All shortcuts also appear in the macOS menu bar (see "Native menu" below) so
they're discoverable and customizable via System Settings.

The first tab spawns automatically on app launch (matches today's startup).

## Architecture

### Rust backend

`PtyState` is removed. Each PTY becomes a `PtyHandle` stored in Tauri's
built-in `ResourceTable`, identified by a `ResourceId` (`u32`). The
`ResourceId` is the only routing key — frontend tabs use it directly as
their `id`.

```rust
pub struct PtyHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
}

impl tauri::Resource for PtyHandle {}
```

`Resource` requires `Send + Sync + 'static`. `MasterPty` and `Box<dyn Write>`
are `Send` but not `Sync`, so we wrap them in `Mutex` (matching the
pattern used by today's `PtyState`). `cwd` is not stored on the backend
— the frontend tracks each tab's cwd in a ref, populated by `pty:cwd`
events, and passes it back as the `cwd` arg to `pty_spawn` on `Cmd+T`.

Commands take a `rid: ResourceId`:

- `pty_spawn(app, events, cols, rows, cwd: Option<String>) -> ResourceId`
  Spawns a new PTY, builds a `PtyHandle`, calls
  `app.resources_table().add(handle)`, and returns the resulting `rid`.
  Optional `cwd` overrides the starting directory; falls back to `$HOME`
  if absent or invalid.
- `pty_write(app, rid, data)` — looks up the handle via
  `app.resources_table().get::<PtyHandle>(rid)?`, writes to its writer.
- `pty_resize(app, rid, cols, rows)` — same lookup, resizes the master.
- `pty_close(app, rid)` — `app.resources_table().close(rid)`. The handle
  is dropped, the master goes out of scope, the child receives `SIGHUP`
  and exits, and the existing reader loop in `spawn_blocking` emits
  `PtyEvent::Exit` when the read returns 0. Manual close and natural exit
  converge on the same path.

The reader loop captures `rid` at spawn time so its OSC events and the
final `pty:exit` emission carry the routing key.

Events from the per-PTY `Channel<PtyEvent>` already scope cleanly to their
PTY — no routing needed for the data stream itself.

### OSC routing

`OscPerformer` gains a `rid: ResourceId` field. Every emit is structured:

- `pty:title` → `{ rid: u32, title: String }`
- `pty:cwd` → `{ rid: u32, cwd: String }` (new — emitted on OSC 7)
- `pty:exit` → `{ rid: u32 }` (new — emitted from reader loop on EOF)

OSC 7 (`ESC ] 7 ; file://host/path BEL`) is parsed in `OscPerformer`,
URL-decoded, host stripped, and forwarded as a `pty:cwd` event. Malformed
URLs are ignored.

### Shell integration

Each shell's integration script gains a one-shot snippet that emits OSC 7 on
every prompt:

- `bash/piyo.bash`: `PROMPT_COMMAND` chain appends `printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"`.
- `zsh/.zshenv` (or sourced rc): `precmd` hook with the same.
- `fish/vendor_conf.d/piyo.fish`: `function __piyo_osc7 --on-event fish_prompt`.
- `nushell/vendor/autoload/piyo.nu`: append to `$env.PROMPT_COMMAND`.

Hostnames are emitted because OSC 7 spec requires them, but the parser
ignores any non-empty host (cwd-only matters).

### React frontend

State lives in `App.tsx`. Tab `id` is the backend `ResourceId` — there's
only one ID space.

```ts
type Tab = { id: number; title: string }; // id === backend ResourceId

const [tabs, setTabs] = useState<Tab[]>([]);
const [activeId, setActiveId] = useState<number | null>(null);
const cwdRef = useRef(new Map<number, string>()); // rid → last-known cwd
```

`Terminal` is refactored to a per-tab component:

```tsx
<Terminal
  rid={number}                                         // backend ResourceId, known before mount
  channel={Channel<PtyEvent>}                          // pre-created by App, drives the xterm
  active={boolean}                                     // visibility / focus
  onResize={(cols: number, rows: number) => void}      // bubbles to App's dimsRef
/>
```

Each tab renders its own `<Terminal>`. Inactive tabs stay mounted but
hidden via `visibility: hidden` and `pointer-events: none`, so xterm,
the WebGL renderer, and scrollback survive untouched. When a tab becomes
active, its `Terminal` calls `term.focus()`.

App is the spawner. The flow for any new tab (first tab or `Cmd+T`):

1. App creates `channel = new Channel<PtyEvent>()`.
2. App reads cols/rows from a ref tracking the last active terminal's
   dimensions (or sensible defaults like 80×24 for the first tab).
3. App calls `pty_spawn(channel, cols, rows, cwd)`, awaits the new `rid`.
4. App pushes `{ id: rid, title: "" }` into `tabs` and sets `activeId`.
5. `<Terminal rid={rid} channel={channel} active />` mounts; on mount
   it opens xterm, attaches `channel.onmessage` to write to xterm, fits,
   and sends `pty_resize(rid, cols, rows)` to correct backend dims.

The Channel cleanly delimits each tab's data stream — `Terminal` doesn't
need to filter by `rid` for data. Title, cwd, and exit events come via
global `pty:title` / `pty:cwd` / `pty:exit` listeners in `App.tsx` (those
_do_ carry `rid` because they're fan-out events from `OscPerformer`).

Top-level event listeners in `App.tsx`:

```ts
listen<{ rid: number; title: string }>("pty:title", (e) =>
    setTabs((t) => t.map((x) => (x.id === e.payload.rid ? { ...x, title: e.payload.title } : x))),
);

listen<{ rid: number; cwd: string }>("pty:cwd", (e) =>
    cwdRef.current.set(e.payload.rid, e.payload.cwd),
);

listen<{ rid: number }>("pty:exit", (e) => {
    setTabs((t) => {
        const next = t.filter((x) => x.id !== e.payload.rid);
        if (next.length === 0) getCurrentWindow().close();
        return next;
    });
    cwdRef.current.delete(e.payload.rid);
});
```

Active-id reassignment on close: pick the tab to the right of the closed
one, or the last remaining tab if the closed one was rightmost.

### Native menu (keyboard shortcuts)

All tab shortcuts are wired through the macOS menu bar via Tauri's JS
menu API (`@tauri-apps/api/menu`). On macOS, accelerators registered with
native menu items are intercepted at the OS level before the webview /
xterm receives them, so we don't need a window `keydown` listener for these.
The same callback runs whether the user clicks the menu item or hits the
accelerator.

Menu construction lives in a dedicated module (`src/menu.ts`) called once
from `App.tsx` after first mount. To keep callbacks reading current state
without rebuilding the menu on every render, we use a ref-based pattern:

```ts
const dimsRef = useRef({ cols: 80, rows: 24 }); // updated by Terminal on resize
const stateRef = useRef({ tabs, activeId, cwdMap: cwdRef.current, dimsRef });
useEffect(() => {
    stateRef.current = { tabs, activeId, cwdMap: cwdRef.current, dimsRef };
});

// Menu callback reads from stateRef.current at call time, not closure time.
```

`Terminal` reports its current cols/rows back to App via an `onResize`
prop so `dimsRef` always reflects the active terminal's size — used as
the initial size hint when spawning a new tab.

Menu layout (mirrors Terminal.app conventions):

- **Piyo** — predefined: About, Hide, Hide Others, Show All, Quit
- **Edit** — predefined: Undo, Redo, Cut, Copy, Paste, Select All
- **Shell**
    - New Tab — `Cmd+T` → spawn with active tab's cwd
    - Close Tab — `Cmd+W` → `pty_close(activeId)`
- **Window** (predefined Minimize/Zoom + custom)
    - Minimize, Zoom (predefined)
    - Select Previous Tab — `Cmd+Shift+[`
    - Select Next Tab — `Cmd+Shift+]`
    - Show Tab 1 — `Cmd+1` … Show Tab 9 — `Cmd+9` (last tab if N > count)

Items that depend on tab state (Close Tab, Select Previous/Next, Show Tab N)
are conditionally enabled via `MenuItem.setEnabled(...)` from a small effect
that watches `tabs` and `activeId`. Disabled-when-no-tabs avoids the no-op
case at app startup before the first tab spawns.

### Titlebar

`Titlebar.tsx` stays a thin shell. `App.tsx` chooses what to render inside:

- `tabs.length === 1`: centered title text. The current `titleOpacity`
  fade-on-sidebar-open is **removed** — the title stays at full opacity at
  all times. To keep the title from sitting under the sidebar when it's
  open, the title's container gets a `paddingLeft` driven by the existing
  `sizeMV` motion value, so the title centers within the terminal area
  rather than the full window. (Replaces the `motion.span` opacity
  transform with a `motion.div` width/padding transform.)
- `tabs.length >= 2`: a new `TabBar` component renders a horizontal row of
  tabs in the same terminal-area-centered region (same `paddingLeft`
  driven by `sizeMV`). Tabs share available width equally, with a min
  width and ellipsis truncation. Each tab:
    - Title text (truncated)
    - Close × visible on hover (any tab, active included — matches Ghostty)
    - Active tab styled with the existing accent variables
    - Sortable via dnd-kit (drag to reorder)
    - Empty filler space around the strip carries `data-tauri-drag-region`
      so the user can still grab the titlebar to move the window. Tabs
      themselves do _not_ carry the drag-region attribute — that would steal
      pointer events from dnd-kit's drag sensor.

The title and tabs are always visible regardless of sidebar state — no
opacity fade. Sidebar open → titlebar contents shift right with the
animation. Sidebar closed → contents recentre across the full width.

### Tab reorder (dnd-kit)

`@dnd-kit/core` + `@dnd-kit/sortable`. `TabBar` wraps its row in:

```tsx
<DndContext sensors={sensors} onDragEnd={handleDragEnd}>
  <SortableContext items={tabs.map(t => t.id)} strategy={horizontalListSortingStrategy}>
    {tabs.map(tab => <SortableTab key={tab.id} tab={tab} ... />)}
  </SortableContext>
</DndContext>
```

`SortableTab` calls `useSortable({ id: tab.id })` and applies the resulting
`transform` / `transition` styles. Sensors: `PointerSensor` with an
`activationConstraint: { distance: 4 }` so a click doesn't start a drag.

`handleDragEnd` reorders `tabs` via `arrayMove(tabs, oldIndex, newIndex)`.
Reordering does not touch backend state — `rid` is stable, the order
in the array is the only thing that changes.

The macOS menu's "Show Tab N" items use the array's _display_ order, so
after reordering, `Cmd+3` jumps to the third tab in the strip — matching
user intuition.

## Data flow

### Cmd+T

```
"New Tab" menu item or Cmd+T accelerator
  → menu callback in App
  → cwd = stateRef.current.cwdMap.get(activeId)
  → cols, rows = stateRef.current.dimsRef.current (last active terminal's size)
  → channel = new Channel<PtyEvent>()
  → rid = await pty_spawn(channel, cols, rows, cwd)   // ResourceId
  → setTabs(prev => [...prev, { id: rid, title: "" }])
  → setActiveId(rid)
  → <Terminal rid={rid} channel={channel} active /> mounts
  → xterm opens, fits, calls pty_resize(rid, cols, rows)
  → shell starts, data flows through channel; OSC events flow via globals
```

### Cmd+W (or close ×)

```
"Close Tab" menu item, Cmd+W accelerator, or close-× click
  → pty_close(targetRid)
  → resources_table().close(rid) drops the PtyHandle
  → master goes out of scope, child receives SIGHUP, exits
  → reader loop returns 0, emits PtyEvent::Exit + pty:exit { rid }
  → App's pty:exit listener removes tab
  → if tabs.length === 0 after removal, getCurrentWindow().close()
```

### Shell-initiated exit (`exit` typed at prompt)

Same as Cmd+W from the `pty_close` step onward — the SIGHUP path and the
natural-exit path converge in the reader loop.

## Component boundaries

| Unit                    | Responsibility                                                                  | Depends on                                                      |
| ----------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `PtyHandle` (Rust)      | `tauri::Resource` wrapping master/writer in mutexes; lookups via ResourceTable  | `portable_pty`, `tauri::Resource`                               |
| `OscPerformer` (Rust)   | Parse OSC 0/2/7/9/777/7496; emit per-tab events tagged with `rid`               | rid, AppHandle                                                  |
| Shell integration files | Emit OSC 7 on every prompt                                                      | (none)                                                          |
| `App.tsx`               | Tab list, active rid, cwd ref, listeners, titlebar mode, menu init              | `Terminal`, `TabBar`, `Titlebar`, `menu.ts`                     |
| `Terminal.tsx`          | One xterm + PTY for one tab; visible/hidden via `active` prop                   | `rid`, Tauri commands                                           |
| `TabBar.tsx` (new)      | Sortable horizontal tab row, hover/active ×, click-to-activate, dnd-kit reorder | `@dnd-kit/core`, `@dnd-kit/sortable`, tabs, activeId, callbacks |
| `Titlebar.tsx`          | Drag region, height, padding-for-traffic-lights                                 | (children only)                                                 |
| `menu.ts` (new)         | Build the macOS menu and bind callbacks via stateRef                            | `@tauri-apps/api/menu`, stateRef                                |

Each unit can be reasoned about in isolation. Notably, `Terminal` no longer
owns title state at all — it just sends data to its `rid` and lets OSC
events flow through `App.tsx`.

## Error handling

- `pty_spawn` failure (rare — fork/exec error): backend returns the existing
  `CommandError`. Frontend logs and toasts via the existing notification
  plugin; doesn't push a tab. If this happens at app launch (no tabs yet),
  the window stays empty and shows an error state — minimal: a centered
  error label is fine.
- `pty_write` / `pty_resize` with an unknown `rid`: `resources_table().get`
  returns `Error::ResourceTableError`; backend converts to `CommandError`
  and the frontend swallows — it's a normal race with exit.
- `pty_close` with an unknown `rid`: same — `close` returns an error,
  frontend ignores.
- OSC 7 with malformed URL or non-file scheme: ignored. Last good cwd
  stays in `cwdRef` on the frontend.
- Cmd+T while previous spawn is in flight: `pty_spawn` is `async` already.
  Just await — the result will arrive in order.

## Testing

This project has no automated test runner today; verification is manual.

- Spawn 2 tabs with `Cmd+T`; switch with `Cmd+Shift+[/]`, `Cmd+1`/`Cmd+2`,
  and click. Confirm keystrokes route to the active tab only.
- Verify the macOS menu bar shows Shell → New Tab / Close Tab and Window →
  Select Previous/Next Tab / Show Tab N. Click each item; confirm same
  behavior as the accelerator.
- Run a long-lived TUI in tab 1 (e.g. `vim`), switch away, switch back —
  no redraw / state corruption.
- Verify cwd inheritance: `cd /tmp` in tab 1, `Cmd+T` → tab 2 is in
  `/tmp`. Repeat per shell (bash, zsh, fish, nu).
- Type `exit` in a tab — tab disappears. Last tab `exit` closes window.
- `Cmd+W` in last tab closes window.
- Open the sidebar in single-tab mode: title remains at full opacity (no
  fade) and shifts right to stay centered within the terminal area.
  Close the sidebar: title recentres across the full width.
- Multi-tab + sidebar open: tab strip stays at full opacity and shifts
  with the sidebar animation; no overlap with the sidebar.
- 2+ tab titlebar: × shows on hover for any tab (active or not); click
  closes that tab.
- Drag a tab to reorder; verify `Cmd+N` jumps to the new position; verify
  the empty filler around tabs still drags the window.

## Out of scope (YAGNI)

- Tab renaming by user
- Splits / panes within a tab
- Persisting tabs across app restarts
- `Cmd+Shift+T` (reopen closed tab)
- Linux / Windows shell integration for OSC 7 (project is macOS-only today)
- New-tab button (`+`) in the tab bar (`Cmd+T` is the entry point for v1)
