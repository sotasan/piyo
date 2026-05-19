# Pin piyo's bundled helper bin to the front of PATH so it overrides any
# user-installed equivalents (idempotent, runs once at autoload).
if "PIYO_BIN" in $env {
    let bin = $env.PIYO_BIN
    let path = $env.PATH
    if ($path | is-empty) or (($path | first) != $bin) {
        $env.PATH = ([$bin] ++ ($path | where {|p| $p != $bin }))
    }
}

# pre_prompt: bar cursor with steady blink, and emit OSC 7 with a
# url-encoded cwd. The OSC 7 spec wants percent-encoded paths;
# bash/zsh/fish punt on this, but `url encode` is one builtin call
# in nu so we do it right.
$env.config.hooks.pre_prompt = (
    ($env.config.hooks.pre_prompt? | default [])
    | append {|| print -n $"(ansi -e '[5 q')(ansi -e '[?12l')(ansi -e '[?12h')" }
    | append {||
        let cwd = ($env.PWD | url encode)
        print -n $"(ansi -e $']7;file://(sys host | get hostname)/($cwd)\u{1b}\\')"
    }
)

# pre_execution: block cursor for the duration of the command.
$env.config.hooks.pre_execution = (
    ($env.config.hooks.pre_execution? | default [])
    | append {|| print -n "\u{1b}[2 q" }
)
