//! Frontend → PTY input encoding.
//!
//! These Tauri commands take browser-shaped key / mouse events and use
//! [`libghostty_vt::key::Encoder`] / [`libghostty_vt::mouse::Encoder`] to
//! produce the correct VT escape sequences for the terminal's current modes.
//! The encoder reads from a [`vt::SharedModes`] snapshot that the session
//! refreshes after every `vt_write`, so they can run on the Tauri command
//! thread without touching the `!Send` [`libghostty_vt::Terminal`].

use std::io::Write;

use anyhow::Context;
use libghostty_vt::{
    key::{self, Action as KeyAction, Key, KittyKeyFlags, Mods},
    mouse::{self, Action as MouseAction, Button, EncoderSize, Format, Position, TrackingMode},
};
use tauri::{AppHandle, Manager, ResourceId};

use crate::pty::{CommandResult, PtyHandle};
use crate::vt::{MouseFormat, MouseTracking};

/// Frontend modifier bits. The frontend doesn't know libghostty's internal
/// bit positions, so we define a stable wire format here.
const MOD_SHIFT: u16 = 1 << 0;
const MOD_CTRL: u16 = 1 << 1;
const MOD_ALT: u16 = 1 << 2;
const MOD_SUPER: u16 = 1 << 3;

fn parse_mods(bits: u16) -> Mods {
    let mut m = Mods::empty();
    if bits & MOD_SHIFT != 0 {
        m |= Mods::SHIFT;
    }
    if bits & MOD_CTRL != 0 {
        m |= Mods::CTRL;
    }
    if bits & MOD_ALT != 0 {
        m |= Mods::ALT;
    }
    if bits & MOD_SUPER != 0 {
        m |= Mods::SUPER;
    }
    m
}

#[tauri::command]
pub fn pty_send_key(
    app: AppHandle,
    rid: ResourceId,
    code: String,
    mods: u16,
    text: Option<String>,
    unshifted: Option<u32>,
    action: u8,
) -> CommandResult<()> {
    let handle = app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?;
    let modes = *handle.modes.lock().unwrap();

    let mut encoder = key::Encoder::new().context("key encoder init failed")?;
    encoder
        .set_cursor_key_application(modes.cursor_key_application)
        .set_keypad_key_application(modes.keypad_key_application)
        .set_alt_esc_prefix(modes.alt_esc_prefix)
        .set_kitty_flags(KittyKeyFlags::from_bits_retain(modes.kitty_flags));

    let mut event = key::Event::new().context("key event init failed")?;
    event
        .set_action(parse_key_action(action))
        .set_key(parse_key_code(&code))
        .set_mods(parse_mods(mods));
    if let Some(t) = text {
        event.set_utf8(Some(t));
    }
    if let Some(u) = unshifted.and_then(char::from_u32) {
        event.set_unshifted_codepoint(u);
    }

    let mut buf = Vec::new();
    encoder
        .encode_to_vec(&event, &mut buf)
        .context("key encode failed")?;
    if buf.is_empty() {
        return Ok(());
    }

    let mut writer = handle.writer.lock().unwrap();
    writer.write_all(&buf).context("pty write failed")?;
    writer.flush().context("pty flush failed")?;
    Ok(())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseSize {
    pub screen_width: u32,
    pub screen_height: u32,
    pub cell_width: u32,
    pub cell_height: u32,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MouseInput {
    pub action: u8,
    pub button: Option<u8>,
    pub mods: u16,
    pub x: f32,
    pub y: f32,
    pub size: MouseSize,
    pub any_pressed: bool,
}

#[tauri::command]
pub fn pty_send_mouse(app: AppHandle, rid: ResourceId, input: MouseInput) -> CommandResult<()> {
    let handle = app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?;
    let modes = *handle.modes.lock().unwrap();
    if matches!(modes.mouse_tracking, MouseTracking::None) {
        return Ok(());
    }

    let mut encoder = mouse::Encoder::new().context("mouse encoder init failed")?;
    encoder
        .set_tracking_mode(map_tracking(modes.mouse_tracking))
        .set_format(map_format(modes.mouse_format))
        .set_size(EncoderSize {
            screen_width: input.size.screen_width,
            screen_height: input.size.screen_height,
            cell_width: input.size.cell_width.max(1),
            cell_height: input.size.cell_height.max(1),
            padding_top: 0,
            padding_bottom: 0,
            padding_left: 0,
            padding_right: 0,
        })
        .set_any_button_pressed(input.any_pressed)
        .set_track_last_cell(true);

    let mut event = mouse::Event::new().context("mouse event init failed")?;
    event
        .set_action(parse_mouse_action(input.action))
        .set_button(input.button.and_then(parse_mouse_button))
        .set_mods(parse_mods(input.mods))
        .set_position(Position {
            x: input.x,
            y: input.y,
        });

    let mut buf = Vec::new();
    encoder
        .encode_to_vec(&event, &mut buf)
        .context("mouse encode failed")?;
    if buf.is_empty() {
        return Ok(());
    }

    let mut writer = handle.writer.lock().unwrap();
    writer.write_all(&buf).context("pty write failed")?;
    writer.flush().context("pty flush failed")?;
    Ok(())
}

#[tauri::command]
pub fn pty_scroll(app: AppHandle, rid: ResourceId, delta: i32) -> CommandResult<()> {
    let handle = app
        .resources_table()
        .get::<PtyHandle>(rid)
        .context("unknown pty rid")?;
    crate::pty::dispatch_scroll(&handle, delta as isize);
    Ok(())
}

fn map_tracking(t: MouseTracking) -> TrackingMode {
    match t {
        MouseTracking::None => TrackingMode::None,
        MouseTracking::X10 => TrackingMode::X10,
        MouseTracking::Normal => TrackingMode::Normal,
        MouseTracking::Button => TrackingMode::Button,
        MouseTracking::Any => TrackingMode::Any,
    }
}

fn map_format(f: MouseFormat) -> Format {
    match f {
        MouseFormat::X10 => Format::X10,
        MouseFormat::Utf8 => Format::Utf8,
        MouseFormat::Sgr => Format::Sgr,
        MouseFormat::Urxvt => Format::Urxvt,
        MouseFormat::SgrPixels => Format::SgrPixels,
    }
}

fn parse_key_action(a: u8) -> KeyAction {
    match a {
        1 => KeyAction::Release,
        2 => KeyAction::Repeat,
        _ => KeyAction::Press,
    }
}

fn parse_mouse_action(a: u8) -> MouseAction {
    match a {
        1 => MouseAction::Release,
        2 => MouseAction::Motion,
        _ => MouseAction::Press,
    }
}

fn parse_mouse_button(b: u8) -> Option<Button> {
    Some(match b {
        0 => Button::Left,
        1 => Button::Middle,
        2 => Button::Right,
        3 => Button::Four,
        4 => Button::Five,
        _ => return None,
    })
}

/// Map a [KeyboardEvent.code](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values)
/// string to a libghostty [`Key`]. The variant names are designed to line
/// up with the web spec, so this is a near-1:1 transliteration of the
/// codes piyo will ever see in practice (printable keys, navigation,
/// function keys, modifiers and numpad).
fn parse_key_code(code: &str) -> Key {
    match code {
        "Backquote" => Key::Backquote,
        "Backslash" => Key::Backslash,
        "BracketLeft" => Key::BracketLeft,
        "BracketRight" => Key::BracketRight,
        "Comma" => Key::Comma,
        "Digit0" => Key::Digit0,
        "Digit1" => Key::Digit1,
        "Digit2" => Key::Digit2,
        "Digit3" => Key::Digit3,
        "Digit4" => Key::Digit4,
        "Digit5" => Key::Digit5,
        "Digit6" => Key::Digit6,
        "Digit7" => Key::Digit7,
        "Digit8" => Key::Digit8,
        "Digit9" => Key::Digit9,
        "Equal" => Key::Equal,
        "IntlBackslash" => Key::IntlBackslash,
        "IntlRo" => Key::IntlRo,
        "IntlYen" => Key::IntlYen,
        "KeyA" => Key::A,
        "KeyB" => Key::B,
        "KeyC" => Key::C,
        "KeyD" => Key::D,
        "KeyE" => Key::E,
        "KeyF" => Key::F,
        "KeyG" => Key::G,
        "KeyH" => Key::H,
        "KeyI" => Key::I,
        "KeyJ" => Key::J,
        "KeyK" => Key::K,
        "KeyL" => Key::L,
        "KeyM" => Key::M,
        "KeyN" => Key::N,
        "KeyO" => Key::O,
        "KeyP" => Key::P,
        "KeyQ" => Key::Q,
        "KeyR" => Key::R,
        "KeyS" => Key::S,
        "KeyT" => Key::T,
        "KeyU" => Key::U,
        "KeyV" => Key::V,
        "KeyW" => Key::W,
        "KeyX" => Key::X,
        "KeyY" => Key::Y,
        "KeyZ" => Key::Z,
        "Minus" => Key::Minus,
        "Period" => Key::Period,
        "Quote" => Key::Quote,
        "Semicolon" => Key::Semicolon,
        "Slash" => Key::Slash,
        "AltLeft" => Key::AltLeft,
        "AltRight" => Key::AltRight,
        "Backspace" => Key::Backspace,
        "CapsLock" => Key::CapsLock,
        "ContextMenu" => Key::ContextMenu,
        "ControlLeft" => Key::ControlLeft,
        "ControlRight" => Key::ControlRight,
        "Enter" => Key::Enter,
        "MetaLeft" => Key::MetaLeft,
        "MetaRight" => Key::MetaRight,
        "ShiftLeft" => Key::ShiftLeft,
        "ShiftRight" => Key::ShiftRight,
        "Space" => Key::Space,
        "Tab" => Key::Tab,
        "Delete" => Key::Delete,
        "End" => Key::End,
        "Help" => Key::Help,
        "Home" => Key::Home,
        "Insert" => Key::Insert,
        "PageDown" => Key::PageDown,
        "PageUp" => Key::PageUp,
        "ArrowDown" => Key::ArrowDown,
        "ArrowLeft" => Key::ArrowLeft,
        "ArrowRight" => Key::ArrowRight,
        "ArrowUp" => Key::ArrowUp,
        "NumLock" => Key::NumLock,
        "Numpad0" => Key::Numpad0,
        "Numpad1" => Key::Numpad1,
        "Numpad2" => Key::Numpad2,
        "Numpad3" => Key::Numpad3,
        "Numpad4" => Key::Numpad4,
        "Numpad5" => Key::Numpad5,
        "Numpad6" => Key::Numpad6,
        "Numpad7" => Key::Numpad7,
        "Numpad8" => Key::Numpad8,
        "Numpad9" => Key::Numpad9,
        "NumpadAdd" => Key::NumpadAdd,
        "NumpadDecimal" => Key::NumpadDecimal,
        "NumpadDivide" => Key::NumpadDivide,
        "NumpadEnter" => Key::NumpadEnter,
        "NumpadEqual" => Key::NumpadEqual,
        "NumpadMultiply" => Key::NumpadMultiply,
        "NumpadSubtract" => Key::NumpadSubtract,
        "NumpadComma" => Key::NumpadComma,
        "Escape" => Key::Escape,
        "F1" => Key::F1,
        "F2" => Key::F2,
        "F3" => Key::F3,
        "F4" => Key::F4,
        "F5" => Key::F5,
        "F6" => Key::F6,
        "F7" => Key::F7,
        "F8" => Key::F8,
        "F9" => Key::F9,
        "F10" => Key::F10,
        "F11" => Key::F11,
        "F12" => Key::F12,
        "F13" => Key::F13,
        "F14" => Key::F14,
        "F15" => Key::F15,
        "F16" => Key::F16,
        "F17" => Key::F17,
        "F18" => Key::F18,
        "F19" => Key::F19,
        "F20" => Key::F20,
        "PrintScreen" => Key::PrintScreen,
        "ScrollLock" => Key::ScrollLock,
        "Pause" => Key::Pause,
        _ => Key::Unidentified,
    }
}
