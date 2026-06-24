<p align="center">
    <img src="assets/icon.png" alt="Piyo" width="128" height="128">
</p>

<h1 align="center">Piyo</h1>

<p align="center">いちばん心地よいターミナルエミュレーター 🐥</p>

<p align="center">
    <a href="README.md">English</a> | <a href="README.de.md">Deutsch</a> | <a href="README.fr.md">Français</a> | 日本語 | <a href="README.zh.md">简体中文</a>
</p>

> [!WARNING]
> **これは Piyo をネイティブ Swift でゼロから作り直している、開発中の初期バージョンです。**
> 公開済みのアプリではなく、頻繁に変更されます。
> 安定版については [インストール](#インストール) を参照してください。

![Piyo](.github/assets/screenshot.png)

## 特長

- ⚡ GPU アクセラレーションによる描画
- 👻 Ghostty 製ターミナルエンジン
- 🖼️ Kitty グラフィックス＆キーボードプロトコル
- 🔤 Unicode と絵文字の完全サポート
- ✒️ フォントリガチャのサポート
- 🍎 ネイティブな macOS の見た目と操作感
- 🗂️ タブ式ターミナルセッション
- ✨ Claude Code および Codex CLI 連携
- 🐚 Bash、Zsh、Fish、Nushell に対応
- 🌐 多言語対応
- 🎨 Shiki ベースのテーマ
- ⚙️ TOML による設定

## インストール

### Homebrew

```sh
brew install --cask sotasan/tap/piyo
```

### 手動

[リリースページ](https://github.com/sotasan/piyo/releases/latest)から最新版をダウンロードしてください。

## 開発

```sh
git clone --recursive https://github.com/sotasan/piyo.git
cd piyo
mise install
mise run setup
xcodegen generate
```

## ライセンス

[MIT](LICENSE)
