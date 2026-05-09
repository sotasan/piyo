fn main() {
    #[cfg(target_os = "macos")]
    {
        cc::Build::new()
            .file("src/macos/context_menu.m")
            .file("src/macos/refresh_rate.m")
            .flag("-fobjc-arc")
            .compile("piyo_macos");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=WebKit");
        println!("cargo:rerun-if-changed=src/macos/context_menu.m");
        println!("cargo:rerun-if-changed=src/macos/refresh_rate.m");
    }

    tauri_build::build()
}
