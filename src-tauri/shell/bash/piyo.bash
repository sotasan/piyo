for _piyo_rc in /etc/profile "$HOME/.bash_profile" "$HOME/.bashrc"; do
    [ -r "$_piyo_rc" ] && . "$_piyo_rc"
done
unset _piyo_rc

__piyo_cursor_bar() { printf '\e[5 q\e[?12l\e[?12h'; }
__piyo_report_cwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }

PROMPT_COMMAND='__piyo_cursor_bar; __piyo_report_cwd;'"${PROMPT_COMMAND-}"
PS0='\e[2 q'"${PS0-}"

if [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" && "$PATH" != "$PIYO_BIN:"* ]]; then
    export PATH="$PIYO_BIN:$PATH"
fi
