function _piyo_prompt_cursor --on-event fish_prompt
    printf '\e[5 q'
end

function _piyo_preexec_cursor --on-event fish_preexec
    printf '\e[1 q'
end
