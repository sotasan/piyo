<p align="center">
    <img src="src-tauri/icons/128x128@2x.png" alt="Piyo" width="128" height="128">
</p>

<h1 align="center">Piyo</h1>

<p align="center">L'émulateur de terminal le plus douillet 🐥</p>

<p align="center">
    <a href="README.md">English</a> | <a href="README.de.md">Deutsch</a> | Français | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">简体中文</a>
</p>

![Piyo](.github/assets/screenshot.png)

## Fonctionnalités

- ⚡ Rendu accéléré par GPU
- 👻 Moteur de terminal propulsé par Ghostty
- 🖼️ Protocoles graphiques et clavier de Kitty
- 🔤 Prise en charge complète d'Unicode et des emoji
- ✒️ Prise en charge des ligatures de police
- 🍎 Apparence native macOS
- 🗂️ Sessions de terminal en onglets
- ✨ Intégration de Claude Code et de la CLI Codex
- 🐚 Intégration de Bash, Zsh, Fish et Nushell
- 🌐 Prise en charge multilingue
- 🎨 Thèmes propulsés par Shiki
- ⚙️ Configuration utilisateur basée sur TOML

## Installation

### Homebrew

```sh
brew install --cask sotasan/tap/piyo
```

### Manuelle

Téléchargez la dernière version depuis la [page des versions](https://github.com/sotasan/piyo/releases/latest).

## Développement

```sh
git clone --recursive https://github.com/sotasan/piyo.git
cd piyo
mise install
mise run setup
xcodegen generate
```

## Licence

[MIT](LICENSE)
