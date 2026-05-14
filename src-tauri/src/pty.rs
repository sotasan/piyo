use std::io::{Read, Write};
use std::path::Path;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use libghostty_vt::{
    key::{Action as KeyAction, Encoder as KeyEncoder, Event as KeyEvent, KittyKeyFlags, Mods},
    mouse::{
        Action as MouseAction, Button, Encoder as MouseEncoder, EncoderSize, Event as MouseEvent,
        Format, Position, TrackingMode,
    },
};
use portable_pty::{MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Manager};
use tauri_specta::Event;

use crate::keycode;
use crate::osc::OscPerformer;
use crate::shell::{self, ResourceDirs, Shell};
use crate::vt::{self, ModeListener, MouseFormat, MouseTracking, Session, TitleListener};
use crate::wire;

const READ_BUF_SIZE: usize = 4096;

#[derive(Debug)]
pub struct CommandError(anyhow::Error);

impl<E: Into<anyhow::Error>> From<E> for CommandError {
    fn from(err: E) -> Self {
        Self(err.into())
    }
}

impl Serialize for CommandError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&format!("{:#}", self.0))
    }
}

impl Type for CommandError {
    fn definition(types: &mut specta::Types) -> specta::datatype::DataType {
        String::definition(types)
    }
}

pub type CommandResult<T> = Result<T, CommandError>;

/// Emitted whenever ghostty's terminal modes change.
#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PtyModes {
    pub rid: u32,
    pub mouse_tracking: bool,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PtyTitle {
    pub rid: u32,
    pub title: String,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PtyCwd {
    pub rid: u32,
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct PtyExit {
    pub rid: u32,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawned {
    pub rid: u32,
    pub shell: String,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct KeyInput {
    pub code: String,
    pub mods: u16,
    pub text: Option<String>,
    pub unshifted: Option<u32>,
    pub action: u8,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MouseSize {
    pub screen_width: u32,
    pub screen_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MouseEventInput {
    pub action: u8,
    pub button: Option<u8>,
    pub mods: u16,
    pub x: f32,
    pub y: f32,
    pub size: MouseSize,
    pub any_pressed: bool,
}

/// Frontend modifier wire format matches `libghostty_vt::key::Mods` bit values
/// for shift/ctrl/alt/super (1/2/4/8); other bits are masked off.
fn parse_mods(bits: u16) -> Mods {
    Mods::from_bits_truncate(bits) & (Mods::SHIFT | Mods::CTRL | Mods::ALT | Mods::SUPER)
}

/// Messages flowing into the session thread. The reader thread sends
/// `Bytes` / `Shutdown`; Tauri commands send the rest. All session-state
/// mutation happens on the session thread because the ghostty `Terminal`
/// is `!Send`.
enum SessionMsg {
    Bytes(Vec<u8>),
    Scroll(isize),
    ScrollTo(u32),
    Resize {
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    },
    Shutdown,
}

type ChildHandle = Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;

pub struct PtyHandle {
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: vt::PtyWriter,
    child: ChildHandle,
    session_tx: Mutex<Sender<SessionMsg>>,
    modes: vt::SharedModes,
}

impl tauri::Resource for PtyHandle {}

impl PtyHandle {
    fn send(&self, msg: SessionMsg) {
        let _ = self.session_tx.lock().unwrap().send(msg);
    }

    fn write_pty(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("failed to write to pty")?;
        w.flush().context("failed to flush pty")?;
        Ok(())
    }

    fn resize(&self, cols: u16, rows: u16, cw: u32, ch: u32) -> Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: u16::try_from(cw.saturating_mul(u32::from(cols))).unwrap_or(u16::MAX),
                pixel_height: u16::try_from(ch.saturating_mul(u32::from(rows))).unwrap_or(u16::MAX),
            })
            .context("failed to resize pty")?;
        self.send(SessionMsg::Resize {
            cols,
            rows,
            cell_width_px: cw,
            cell_height_px: ch,
        });
        Ok(())
    }

    fn scroll(&self, delta: isize) {
        self.send(SessionMsg::Scroll(delta));
    }

    fn scroll_to(&self, offset_up: u32) {
        self.send(SessionMsg::ScrollTo(offset_up));
    }

    fn shutdown(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
        self.send(SessionMsg::Shutdown);
    }

    fn send_key(&self, input: KeyInput) -> Result<()> {
        let modes = *self.modes.lock().unwrap();
        let mut encoder = KeyEncoder::new().context("key encoder init failed")?;
        encoder
            .set_cursor_key_application(modes.cursor_key_application)
            .set_keypad_key_application(modes.keypad_key_application)
            .set_alt_esc_prefix(modes.alt_esc_prefix)
            .set_kitty_flags(KittyKeyFlags::from_bits_retain(modes.kitty_flags));

        let mut event = KeyEvent::new().context("key event init failed")?;
        event
            .set_action(match input.action {
                1 => KeyAction::Release,
                2 => KeyAction::Repeat,
                _ => KeyAction::Press,
            })
            .set_key(keycode::from_web_code(&input.code))
            .set_mods(parse_mods(input.mods));
        if let Some(t) = input.text {
            event.set_utf8(Some(t));
        }
        if let Some(u) = input.unshifted.and_then(char::from_u32) {
            event.set_unshifted_codepoint(u);
        }

        let mut buf = Vec::new();
        encoder
            .encode_to_vec(&event, &mut buf)
            .context("key encode failed")?;
        if !buf.is_empty() {
            self.write_pty(&buf)?;
        }
        Ok(())
    }

    fn send_mouse(&self, input: MouseEventInput) -> Result<()> {
        let modes = *self.modes.lock().unwrap();
        if matches!(modes.mouse_tracking, MouseTracking::None) {
            return Ok(());
        }
        let mut encoder = MouseEncoder::new().context("mouse encoder init failed")?;
        encoder
            .set_tracking_mode(match modes.mouse_tracking {
                MouseTracking::None => TrackingMode::None,
                MouseTracking::X10 => TrackingMode::X10,
                MouseTracking::Normal => TrackingMode::Normal,
                MouseTracking::Button => TrackingMode::Button,
                MouseTracking::Any => TrackingMode::Any,
            })
            .set_format(match modes.mouse_format {
                MouseFormat::X10 => Format::X10,
                MouseFormat::Utf8 => Format::Utf8,
                MouseFormat::Sgr => Format::Sgr,
                MouseFormat::Urxvt => Format::Urxvt,
                MouseFormat::SgrPixels => Format::SgrPixels,
            })
            .set_size(EncoderSize {
                screen_width: input.size.screen_width,
                screen_height: input.size.screen_height,
                cell_width: input.size.cell_width.max(1),
                cell_height: input.size.cell_height.max(1),
                padding_top: 0,
                padding_bottom: 0,
                padding_left: 0,
                padding_right: 0,
            })
            .set_any_button_pressed(input.any_pressed)
            .set_track_last_cell(true);

        let mut event = MouseEvent::new().context("mouse event init failed")?;
        event
            .set_action(match input.action {
                1 => MouseAction::Release,
                2 => MouseAction::Motion,
                _ => MouseAction::Press,
            })
            .set_button(input.button.and_then(|b| match b {
                0 => Some(Button::Left),
                1 => Some(Button::Middle),
                2 => Some(Button::Right),
                3 => Some(Button::Four),
                4 => Some(Button::Five),
                _ => None,
            }))
            .set_mods(parse_mods(input.mods))
            .set_position(Position {
                x: input.x,
                y: input.y,
            });

        let mut buf = Vec::new();
        encoder
            .encode_to_vec(&event, &mut buf)
            .context("mouse encode failed")?;
        if !buf.is_empty() {
            self.write_pty(&buf)?;
        }
        Ok(())
    }
}

fn reap(child: &ChildHandle) {
    if let Some(mut c) = child.lock().unwrap().take() {
        let _ = c.wait();
    }
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    events: Channel<InvokeResponseBody>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> CommandResult<PtySpawned> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open pty")?;

    let shell_path = shell::resolve_path();
    let shell_name = Path::new(&shell_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("sh")
        .to_string();
    let detected = Shell::detect(&shell_path);
    let resource_dir = app
        .path()
        .resource_dir()
        .context("failed to resolve resource dir")?;
    let dirs = ResourceDirs::from_resource_dir(&resource_dir);
    let cwd_path = cwd.as_ref().map(Path::new).filter(|p| p.is_dir());
    let cmd = shell::build_command(&shell_path, &detected, &dirs, cwd_path)?;

    let child = pair
        .slave
        .spawn_command(cmd)
        .context("failed to spawn shell")?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .context("failed to clone pty reader")?;
    let writer = pair
        .master
        .take_writer()
        .context("failed to take pty writer")?;

    let child: ChildHandle = Arc::new(Mutex::new(Some(child)));
    let child_for_reader = child.clone();

    let writer: vt::PtyWriter = Arc::new(Mutex::new(writer));
    let writer_for_vt = writer.clone();
    let modes: vt::SharedModes = Arc::new(Mutex::new(vt::Modes::default()));
    let modes_for_vt = modes.clone();

    let (session_tx, session_rx) = std::sync::mpsc::channel::<SessionMsg>();
    let session_tx_for_reader = session_tx.clone();

    let handle = PtyHandle {
        master: Mutex::new(pair.master),
        writer,
        child,
        session_tx: Mutex::new(session_tx),
        modes,
    };

    let rid = app.resources_table().add(handle);

    let app_for_osc = app.clone();
    tokio::task::spawn_blocking(move || {
        let mut parser = vte::Parser::new();
        let mut performer = OscPerformer::new(app_for_osc, rid);
        let mut buf = [0u8; READ_BUF_SIZE];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = &buf[..n];
                    parser.advance(&mut performer, chunk);
                    if session_tx_for_reader
                        .send(SessionMsg::Bytes(chunk.to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = session_tx_for_reader.send(SessionMsg::Shutdown);
    });

    // Session thread: owns the ghostty Terminal (which is `!Send`).
    let app_for_session = app.clone();
    std::thread::spawn(move || {
        let mode_listener = ModeEmit {
            app: app_for_session.clone(),
            rid,
        };
        let title_listener = TitleEmit {
            app: app_for_session.clone(),
            rid,
        };
        let mut session = match Session::new(
            cols,
            rows,
            writer_for_vt,
            modes_for_vt,
            mode_listener,
            title_listener,
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "ghostty vt session init failed");
                return;
            }
        };

        let emit_frame = |bytes: Result<Option<Vec<u8>>>| -> bool {
            match bytes {
                Ok(Some(b)) => events.send(InvokeResponseBody::Raw(b)).is_ok(),
                Ok(None) => true,
                Err(e) => {
                    tracing::error!(error = %e, "ghostty session error");
                    true
                }
            }
        };

        while let Ok(msg) = session_rx.recv() {
            match msg {
                SessionMsg::Bytes(b) => {
                    if !emit_frame(session.feed(&b)) {
                        break;
                    }
                }
                SessionMsg::Scroll(delta) => {
                    if !emit_frame(session.scroll_viewport(delta)) {
                        break;
                    }
                }
                SessionMsg::ScrollTo(offset) => {
                    if !emit_frame(session.scroll_to_offset(offset)) {
                        break;
                    }
                }
                SessionMsg::Resize {
                    cols,
                    rows,
                    cell_width_px,
                    cell_height_px,
                } => {
                    if let Err(e) = session.resize(cols, rows, cell_width_px, cell_height_px) {
                        tracing::error!(error = %e, "ghostty resize error");
                    }
                }
                SessionMsg::Shutdown => break,
            }
        }

        reap(&child_for_reader);
        let _ = events.send(InvokeResponseBody::Raw(wire::exit_event()));
        let _ = PtyExit { rid }.emit(&app_for_session);
    });

    Ok(PtySpawned {
        rid,
        shell: shell_name,
    })
}

#[tauri::command]
#[specta::specta]
pub fn pty_write(app: AppHandle, rid: u32, data: String) -> CommandResult<()> {
    handle(&app, rid)?.write_pty(data.as_bytes())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_resize(
    app: AppHandle,
    rid: u32,
    cols: u16,
    rows: u16,
    cell_width: Option<u32>,
    cell_height: Option<u32>,
) -> CommandResult<()> {
    handle(&app, rid)?.resize(
        cols,
        rows,
        cell_width.unwrap_or(0),
        cell_height.unwrap_or(0),
    )?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_close(app: AppHandle, rid: u32) -> CommandResult<()> {
    let Ok(h) = app.resources_table().get::<PtyHandle>(rid) else {
        return Ok(());
    };
    h.shutdown();
    drop(h);
    let _ = app.resources_table().close(rid);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_send_key(app: AppHandle, rid: u32, input: KeyInput) -> CommandResult<()> {
    handle(&app, rid)?.send_key(input)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_send_mouse(app: AppHandle, rid: u32, input: MouseEventInput) -> CommandResult<()> {
    handle(&app, rid)?.send_mouse(input)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_scroll(app: AppHandle, rid: u32, delta: i32) -> CommandResult<()> {
    handle(&app, rid)?.scroll(delta as isize);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn pty_scroll_to(app: AppHandle, rid: u32, offset_up: u32) -> CommandResult<()> {
    handle(&app, rid)?.scroll_to(offset_up);
    Ok(())
}

fn handle(app: &AppHandle, rid: u32) -> CommandResult<Arc<PtyHandle>> {
    Ok(app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?)
}

struct ModeEmit {
    app: AppHandle,
    rid: u32,
}
impl ModeListener for ModeEmit {
    fn on_modes(&self, modes: &vt::Modes) {
        let _ = PtyModes {
            rid: self.rid,
            mouse_tracking: !matches!(modes.mouse_tracking, MouseTracking::None),
        }
        .emit(&self.app);
    }
}

struct TitleEmit {
    app: AppHandle,
    rid: u32,
}
impl TitleListener for TitleEmit {
    fn on_title(&self, title: &str) {
        let _ = PtyTitle {
            rid: self.rid,
            title: title.to_string(),
        }
        .emit(&self.app);
    }
}
