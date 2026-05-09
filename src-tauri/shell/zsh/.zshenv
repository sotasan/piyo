if [[ -n "${PIYO_ZSH_ZDOTDIR+X}" ]]; then
    export ZDOTDIR="$PIYO_ZSH_ZDOTDIR"
    unset PIYO_ZSH_ZDOTDIR
else
    unset ZDOTDIR
fi

[[ -r "${ZDOTDIR-$HOME}/.zshenv" ]] && source "${ZDOTDIR-$HOME}/.zshenv"

if [[ -o interactive ]]; then
    autoload -Uz add-zsh-hook
    _piyo_cursor_bar()   { print -n '\e[5 q\e[?12l\e[?12h\e]7;file://'"$HOST$PWD"'\a' }
    _piyo_cursor_block() { print -n '\e[2 q' }
    add-zsh-hook precmd  _piyo_cursor_bar
    add-zsh-hook preexec _piyo_cursor_block

    _piyo_pin_path() {
        [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" ]] && path=("$PIYO_BIN" "${(@)path:#$PIYO_BIN}")
        add-zsh-hook -d precmd _piyo_pin_path
    }
    add-zsh-hook precmd _piyo_pin_path
fi
