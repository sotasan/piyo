//! Writes `../src/gen/bindings.ts` from the tauri-specta registry.
//!
//! Invoked by `beforeDevCommand` / `beforeBuildCommand` in `tauri.conf.json`
//! so the file is always fresh when Vite starts.
use std::path::Path;

use specta_typescript::Typescript;

fn main() {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let out = manifest_dir
        .join("..")
        .join("src")
        .join("gen")
        .join("bindings.ts");
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).expect("create gen dir");
    }
    piyo_lib::specta_builder::builder()
        .export(Typescript::default().header("// @ts-nocheck\n"), &out)
        .expect("export bindings.ts");
}
