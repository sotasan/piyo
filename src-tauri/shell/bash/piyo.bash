for _piyo_rc in /etc/profile "$HOME/.bash_profile" "$HOME/.bashrc"; do
    [ -r "$_piyo_rc" ] && . "$_piyo_rc"
done
unset _piyo_rc

PROMPT_COMMAND='printf "\e[6 q";'"${PROMPT_COMMAND-}"
PS0='\e[2 q'"${PS0-}"
