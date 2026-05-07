for _piyo_rc in /etc/profile "$HOME/.bash_profile" "$HOME/.bashrc"; do
    [ -r "$_piyo_rc" ] && . "$_piyo_rc"
done
unset _piyo_rc

PROMPT_COMMAND='printf "\e[6 q";'"${PROMPT_COMMAND-}"
bind 'set show-mode-in-prompt on' 2>/dev/null
bind 'set vi-cmd-mode-string \1\e[2 q\2' 2>/dev/null
bind 'set vi-ins-mode-string \1\e[6 q\2' 2>/dev/null
