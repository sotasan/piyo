function _piyo_prompt_cursor --on-event fish_prompt
    printf '\e[6 q'
end

if not set --query fish_cursor_default
    set -g fish_cursor_default block
    set -g fish_cursor_insert line
    set -g fish_cursor_replace_one underscore
    set -g fish_cursor_visual block
end

function _piyo_preexec_cursor --on-event fish_preexec
    printf '\e[0 q'
end
