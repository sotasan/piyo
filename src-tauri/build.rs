fn main() {
    #[cfg(target_os = "macos")]
    {
        let out_dir = std::env::var("OUT_DIR").unwrap();
        bindgen::Builder::default()
            .header("src/macos/piyo.h")
            .allowlist_function("piyo_.*")
            .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
            .generate()
            .expect("bindgen failed")
            .write_to_file(std::path::Path::new(&out_dir).join("macos_bindings.rs"))
            .expect("write bindings");

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
