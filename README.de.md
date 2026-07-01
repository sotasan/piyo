<p align="center">
    <img src="assets/icon.png" alt="Piyo" width="128" height="128">
</p>

<h1 align="center">Piyo</h1>

<p align="center">Der gemütlichste Terminal-Emulator 🐥</p>

<p align="center">
    <a href="README.md">English</a> | Deutsch | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">简体中文</a>
</p>

> [!WARNING]
> **Dies ist eine frühe, in Entwicklung befindliche Version von Piyo, von Grund
> auf neu in SwiftUI und Rust entwickelt.** Sie ist nicht die veröffentlichte App
> und ändert sich ständig. Eine stabile Version findest du unter
> [Installation](#installation).

![Piyo](.github/assets/screenshot.png)

## Funktionen

- ⚡ GPU-beschleunigtes Rendering
- 👻 Ghostty-basierte Terminal-Engine
- 🖼️ Kitty-Grafik- und Tastaturprotokoll
- 🔤 Vollständige Unicode- und Emoji-Unterstützung
- ✒️ Unterstützung für Schrift-Ligaturen
- 🍎 Natives macOS-Erscheinungsbild
- 🗂️ Terminal-Sitzungen in Tabs
- ✨ Claude-Code- und Codex-CLI-Integration
- 🐚 Bash-, Zsh-, Fish- und Nushell-Integration
- 🌐 Mehrsprachige Unterstützung
- 🎨 Shiki-basierte Themes
- ⚙️ TOML-basierte Benutzerkonfiguration

## Installation

### Homebrew

```sh
brew install --cask sotasan/tap/piyo
```

### Manuell

Lade die neueste Version von der [Releases-Seite](https://github.com/sotasan/piyo/releases/latest) herunter.

## Entwicklung

```sh
git clone https://github.com/sotasan/piyo.git
cd piyo
mise trust
mise install
just
```

## Lizenz

[MIT](LICENSE)
