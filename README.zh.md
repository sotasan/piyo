<p align="center">
    <img src="assets/icon.png" alt="Piyo" width="128" height="128">
</p>

<h1 align="center">Piyo</h1>

<p align="center">最舒适的终端模拟器 🐥</p>

<p align="center">
    <a href="README.md">English</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | <a href="README.ja.md">日本語</a> | 简体中文
</p>

> [!WARNING]
> **这是 Piyo 用原生 Swift 从零重写的早期开发版本。**
> 它不是已发布的应用，并且会经常变动。
> 如需稳定版本，请见 [安装](#安装)。

![Piyo](.github/assets/screenshot.png)

## 功能特性

- ⚡ GPU 加速渲染
- 👻 Ghostty 驱动的终端引擎
- 🖼️ Kitty 图形与键盘协议
- 🔤 完整的 Unicode 与表情符号支持
- ✒️ 字体连字支持
- 🍎 原生 macOS 外观与体验
- 🗂️ 标签式终端会话
- ✨ Claude Code 和 Codex CLI 集成
- 🐚 支持 Bash、Zsh、Fish 和 Nushell
- 🌐 多语言支持
- 🎨 Shiki 驱动的主题
- ⚙️ 基于 TOML 的用户配置

## 安装

### Homebrew

```sh
brew install --cask sotasan/tap/piyo
```

### 手动安装

从[发布页面](https://github.com/sotasan/piyo/releases/latest)下载最新版本。

## 开发

```sh
git clone --recursive https://github.com/sotasan/piyo.git
cd piyo
mise install
mise run setup
xcodegen generate
```

## 许可证

[MIT](LICENSE)
