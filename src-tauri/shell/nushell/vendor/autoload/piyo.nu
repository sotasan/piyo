if "PIYO_BIN" in $env {
    let bin = $env.PIYO_BIN
    let path = $env.PATH
    if ($path | is-empty) or (($path | first) != $bin) {
        $env.PATH = ([$bin] ++ ($path | where {|p| $p != $bin }))
    }
}

$env.config.hooks.pre_prompt = (
    ($env.config.hooks.pre_prompt? | default [])
    | append {|| print -n $"(ansi -e '[5 q')(ansi -e '[?12l')(ansi -e '[?12h')" }
    | append {||
        let cwd = ($env.PWD | url encode)
        print -n $"(ansi -e $']7;file://(sys host | get hostname)/($cwd)\u{1b}\\')"
    }
)

$env.config.hooks.pre_execution = (
    ($env.config.hooks.pre_execution? | default [])
    | append {|| print -n "\u{1b}[2 q" }
)
