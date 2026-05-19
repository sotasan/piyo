# Piyo spawns bash as a non-interactive login shell with --rcfile pointing
# here, which skips the usual /etc/profile + ~/.bashrc chain. Source them
# manually so the user's environment still loads.
for _piyo_rc in /etc/profile "$HOME/.bash_profile" "$HOME/.bashrc"; do
    [ -r "$_piyo_rc" ] && . "$_piyo_rc"
done
unset _piyo_rc

# Bar cursor + steady blink (DECSCUSR 5, DECTCEM steady on) for readline editing.
__piyo_cursor_bar() { printf '\e[5 q\e[?12l\e[?12h'; }
# OSC 7: report cwd to the host so the sidebar/tab title can track it.
__piyo_report_cwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
# Pop the kitty keyboard mode pushed in PS0. Readline doesn't want the
# extended protocol — only the foregrounded child process does.
__piyo_kitty_off() { printf '\e[<u'; }

# precmd: drop kitty keyboard, switch to bar cursor, emit cwd.
# PS0 (runs after Enter, before the command): block cursor + push kitty
# keyboard mode 1 so TUI apps (Claude Code, helix, etc.) see Shift+Enter
# and the rest of the disambiguated key encoding.
PROMPT_COMMAND='__piyo_kitty_off; __piyo_cursor_bar; __piyo_report_cwd;'"${PROMPT_COMMAND-}"
PS0='\e[2 q\e[>1u'"${PS0-}"

# Pin piyo's bundled helper bin to the front of PATH so it overrides
# anything the user installed (idempotent: skip if already first).
if [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" && "$PATH" != "$PIYO_BIN:"* ]]; then
    export PATH="$PIYO_BIN:$PATH"
fi
