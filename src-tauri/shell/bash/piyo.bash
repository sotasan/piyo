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

# precmd: bar cursor + cwd. PS0 (after Enter, before the command):
# block cursor for the duration of execution.
PROMPT_COMMAND='__piyo_cursor_bar; __piyo_report_cwd;'"${PROMPT_COMMAND-}"
PS0='\e[2 q'"${PS0-}"

# Pin piyo's bundled helper bin to the front of PATH so it overrides
# anything the user installed (idempotent: skip if already first).
if [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" && "$PATH" != "$PIYO_BIN:"* ]]; then
    export PATH="$PIYO_BIN:$PATH"
fi
