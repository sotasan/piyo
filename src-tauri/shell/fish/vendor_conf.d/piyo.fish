function _piyo_prompt_cursor --on-event fish_prompt
    printf '\e[5 q\e[?12l\e[?12h'
end

function _piyo_preexec_cursor --on-event fish_preexec
    printf '\e[2 q'
end

function _piyo_pin_path --on-event fish_prompt
    if set -q PIYO_BIN; and test -d "$PIYO_BIN"; and test "$PATH[1]" != "$PIYO_BIN"
        set -gx PATH $PIYO_BIN (string match -v -- "$PIYO_BIN" $PATH)
    end
    functions --erase _piyo_pin_path
end
