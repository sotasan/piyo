#[cfg(target_os = "macos")]
extern "C" {
    fn piyo_install_context_menu_filter();
}

pub fn install() {
    #[cfg(target_os = "macos")]
    unsafe {
        piyo_install_context_menu_filter()
    }
}
