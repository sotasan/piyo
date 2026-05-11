<p align="center">
    <img src="src-tauri/icons/128x128@2x.png" alt="Piyo" width="128" height="128">
</p>

<h1 align="center">Piyo</h1>

<p align="center">The coziest terminal emulator 🐥</p>

![Piyo](.github/assets/screenshot.png)

## Features

- ⚡ GPU-accelerated rendering
- 🪟 Native macOS vibrancy and transparency
- 🎨 Customizable themes with user-defined CSS
- 🖼️ Inline images (Sixel, iTerm2)
- 🔗 Clickable hyperlinks
- 📊 Progress reporting (ConEmu OSC 9;4)
- 🔔 Desktop notifications (OSC 9, 777)
- 🤖 Claude Code task-finish banners
- 🐚 Bash, Zsh, Fish, and Nushell shell integration
- 🌈 Full Unicode and emoji width handling
- 🎯 Live macOS accent color sync

## Building from source

The Rust side links against [libghostty-vt](https://github.com/uzaaft/libghostty-rs),
which builds the ghostty terminal library from source at compile time and
requires **Zig 0.15.2**. With [`mise`](https://mise.jdx.dev):

```sh
mise use -g zig@0.15.2
```

## Installation

### Homebrew

```sh
brew install --cask sotasan/tap/piyo
```

### Manual

Download the latest release from the [releases page](https://github.com/sotasan/piyo/releases/latest).

## License

[MIT](LICENSE)
