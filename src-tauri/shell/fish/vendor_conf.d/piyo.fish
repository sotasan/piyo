# Bar cursor + steady blink for line editing.
function _piyo_cursor_bar --on-event fish_prompt
    printf '\e[5 q\e[?12l\e[?12h'
end

# OSC 7: tell the host our cwd so the sidebar/tab title stays in sync.
function _piyo_report_cwd --on-event fish_prompt
    printf '\e]7;file://%s%s\a' (hostname) "$PWD"
end

# Block cursor while a command is running.
function _piyo_cursor_block --on-event fish_preexec
    printf '\e[2 q'
end

# Pin piyo's bundled bin to the front of PATH on the first prompt, then
# erase the function — only needs to run once per session.
function _piyo_pin_path --on-event fish_prompt
    if set -q PIYO_BIN; and test -d "$PIYO_BIN"; and test "$PATH[1]" != "$PIYO_BIN"
        set -gx PATH $PIYO_BIN (string match -v -- "$PIYO_BIN" $PATH)
    end
    functions --erase _piyo_pin_path
end
