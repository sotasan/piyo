if "PIYO_BIN" in $env {
    let bin = $env.PIYO_BIN
    let path = $env.PATH
    if ($path | is-empty) or (($path | first) != $bin) {
        $env.PATH = ([$bin] ++ ($path | where {|p| $p != $bin }))
    }
}

$env.config.hooks.pre_prompt = (
    ($env.config.hooks.pre_prompt? | default [])
    | append {|| print -n "\u{1b}[5 q\u{1b}[?12l\u{1b}[?12h" }
)

$env.config.hooks.pre_execution = (
    ($env.config.hooks.pre_execution? | default [])
    | append {|| print -n "\u{1b}[2 q" }
)
