if [[ -n "${PIYO_ZSH_ZDOTDIR+X}" ]]; then
    export ZDOTDIR="$PIYO_ZSH_ZDOTDIR"
    unset PIYO_ZSH_ZDOTDIR
else
    unset ZDOTDIR
fi

[[ -r "${ZDOTDIR-$HOME}/.zshenv" ]] && source "${ZDOTDIR-$HOME}/.zshenv"

if [[ -o interactive ]]; then
    _piyo_cursor() {
        case ${KEYMAP-} in
            vicmd|visual) print -n '\e[2 q' ;;
            *)            print -n '\e[6 q' ;;
        esac
    }
    _piyo_cursor_reset() { print -n '\e[0 q' }

    autoload -Uz add-zle-hook-widget
    add-zle-hook-widget line-init     _piyo_cursor       2>/dev/null
    add-zle-hook-widget line-finish   _piyo_cursor_reset 2>/dev/null
    add-zle-hook-widget keymap-select _piyo_cursor       2>/dev/null
fi
