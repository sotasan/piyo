if [[ -n "${PIYO_ZSH_ZDOTDIR+X}" ]]; then
    export ZDOTDIR="$PIYO_ZSH_ZDOTDIR"
    unset PIYO_ZSH_ZDOTDIR
else
    unset ZDOTDIR
fi

[[ -r "${ZDOTDIR-$HOME}/.zshenv" ]] && source "${ZDOTDIR-$HOME}/.zshenv"

if [[ -o interactive ]]; then
    autoload -Uz add-zsh-hook
    _piyo_cursor_bar()   { print -n '\e[6 q' }
    _piyo_cursor_block() { print -n '\e[2 q' }
    add-zsh-hook precmd  _piyo_cursor_bar
    add-zsh-hook preexec _piyo_cursor_block
fi
