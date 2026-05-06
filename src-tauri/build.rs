fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/macos/context_menu.m")
            .flag("-fobjc-arc")
            .compile("piyo_context_menu");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rerun-if-changed=src/macos/context_menu.m");
    }

    tauri_build::build()
}
