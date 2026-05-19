# Piyo spawns zsh with ZDOTDIR pointing at this directory so our .zshenv
# is the first one zsh reads. PIYO_ZSH_ZDOTDIR carries the user's original
# ZDOTDIR (or unset) — restore it here, then source the real .zshenv from
# the right place so the user's environment loads normally.
if [[ -n "${PIYO_ZSH_ZDOTDIR+X}" ]]; then
    export ZDOTDIR="$PIYO_ZSH_ZDOTDIR"
    unset PIYO_ZSH_ZDOTDIR
else
    unset ZDOTDIR
fi

[[ -r "${ZDOTDIR-$HOME}/.zshenv" ]] && source "${ZDOTDIR-$HOME}/.zshenv"

# .zshenv runs in every zsh invocation (scripts, non-interactive, etc.).
# Hooks and cursor escapes only make sense for interactive shells.
if [[ -o interactive ]]; then
    autoload -Uz add-zsh-hook
    _piyo_cursor_bar()   { print -n '\e[5 q\e[?12l\e[?12h' }   # bar + steady blink for line editing
    _piyo_cursor_block() { print -n '\e[2 q' }                 # block while a command runs
    _piyo_report_cwd()   { print -n '\e]7;file://'"$HOST$PWD"'\a' }
    # Kitty keyboard protocol: push mode 1 before a command runs (TUI apps
    # need Shift+Enter etc.), pop it at the next prompt so zle / readline
    # see plain keys.
    _piyo_kitty_on()  { print -n '\e[>1u' }
    _piyo_kitty_off() { print -n '\e[<u' }
    add-zsh-hook precmd  _piyo_kitty_off
    add-zsh-hook precmd  _piyo_cursor_bar
    add-zsh-hook precmd  _piyo_report_cwd
    add-zsh-hook preexec _piyo_kitty_on
    add-zsh-hook preexec _piyo_cursor_block

    # One-shot: pin piyo's helper bin to the front of PATH on the first
    # precmd, then unhook itself. Done as a hook (not inline) so it runs
    # *after* the user's .zshrc has fully loaded and any path-rewriters
    # there have settled.
    _piyo_pin_path() {
        [[ -n "${PIYO_BIN-}" && -d "$PIYO_BIN" ]] && path=("$PIYO_BIN" "${(@)path:#$PIYO_BIN}")
        add-zsh-hook -d precmd _piyo_pin_path
    }
    add-zsh-hook precmd _piyo_pin_path
fi
