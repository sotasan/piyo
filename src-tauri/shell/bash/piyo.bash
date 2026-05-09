for _piyo_rc in /etc/profile "$HOME/.bash_profile" "$HOME/.bashrc"; do
    [ -r "$_piyo_rc" ] && . "$_piyo_rc"
done
unset _piyo_rc

_piyo_osc7() { printf '\e]7;file://%s%s\e\\' "${HOSTNAME-}" "$PWD"; }
PROMPT_COMMAND='_piyo_osc7;printf "\e[5 q\e[?12l\e[?12h";'"${PROMPT_COMMAND-}"
PS0='\e[2 q'"${PS0-}"

if [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" && "$PATH" != "$PIYO_BIN:"* ]]; then
    export PATH="$PIYO_BIN:$PATH"
fi
