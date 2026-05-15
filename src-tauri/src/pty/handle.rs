use std::io::Write;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use libghostty_vt::{
    key::{Action as KeyAction, Encoder as KeyEncoder, Event as KeyEvent, KittyKeyFlags, Mods},
    mouse::{
        Action as MouseAction, Button, Encoder as MouseEncoder, EncoderSize, Event as MouseEvent,
        Format, Position, TrackingMode,
    },
};
use portable_pty::{MasterPty, PtySize};

use crate::keycode;
use crate::pty::types::{KeyInput, MouseEventInput};
use crate::vt::{self, MouseFormat, MouseTracking};

pub(super) enum SessionMsg {
    Bytes(Vec<u8>),
    Resize {
        cols: u16,
        rows: u16,
        cell_width_px: u32,
        cell_height_px: u32,
    },
    Shutdown,
}

pub(super) type ChildHandle = Arc<Mutex<Option<Box<dyn portable_pty::Child + Send + Sync>>>>;

pub struct PtyHandle {
    pub(super) master: Mutex<Box<dyn MasterPty + Send>>,
    pub(super) writer: vt::PtyWriter,
    pub(super) child: ChildHandle,
    pub(super) session_tx: Mutex<Sender<SessionMsg>>,
    pub(super) modes: vt::SharedModes,
}

impl tauri::Resource for PtyHandle {}

impl PtyHandle {
    fn send(&self, msg: SessionMsg) {
        let _ = self.session_tx.lock().unwrap().send(msg);
    }

    pub(super) fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("failed to write to pty")?;
        w.flush().context("failed to flush pty")?;
        Ok(())
    }

    pub(super) fn resize(&self, cols: u16, rows: u16, cw: u32, ch: u32) -> Result<()> {
        self.master
            .lock()
            .unwrap()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: u16::try_from(cw.saturating_mul(u32::from(cols))).unwrap_or(u16::MAX),
                pixel_height: u16::try_from(ch.saturating_mul(u32::from(rows))).unwrap_or(u16::MAX),
            })
            .context("failed to resize pty")?;
        self.send(SessionMsg::Resize {
            cols,
            rows,
            cell_width_px: cw,
            cell_height_px: ch,
        });
        Ok(())
    }

    pub(super) fn shutdown(&self) {
        if let Some(child) = self.child.lock().unwrap().as_mut() {
            let _ = child.kill();
        }
        self.send(SessionMsg::Shutdown);
    }

    pub(super) fn send_key(&self, input: KeyInput) -> Result<()> {
        let modes = *self.modes.lock().unwrap();
        let mut encoder = KeyEncoder::new().context("key encoder init failed")?;
        encoder
            .set_cursor_key_application(modes.cursor_key_application)
            .set_keypad_key_application(modes.keypad_key_application)
            .set_alt_esc_prefix(modes.alt_esc_prefix)
            .set_kitty_flags(KittyKeyFlags::from_bits_retain(modes.kitty_flags));

        let mut event = KeyEvent::new().context("key event init failed")?;
        event
            .set_action(match input.action {
                1 => KeyAction::Release,
                2 => KeyAction::Repeat,
                _ => KeyAction::Press,
            })
            .set_key(keycode::from_web_code(&input.code))
            .set_mods(parse_mods(input.mods));
        if let Some(t) = input.text {
            event.set_utf8(Some(t));
        }
        if let Some(u) = input.unshifted.and_then(char::from_u32) {
            event.set_unshifted_codepoint(u);
        }

        let mut buf = Vec::new();
        encoder
            .encode_to_vec(&event, &mut buf)
            .context("key encode failed")?;
        if !buf.is_empty() {
            self.write(&buf)?;
        }
        Ok(())
    }

    pub(super) fn send_mouse(&self, input: MouseEventInput) -> Result<()> {
        let modes = *self.modes.lock().unwrap();
        if matches!(modes.mouse_tracking, MouseTracking::None) {
            return Ok(());
        }
        let mut encoder = MouseEncoder::new().context("mouse encoder init failed")?;
        encoder
            .set_tracking_mode(match modes.mouse_tracking {
                MouseTracking::None => TrackingMode::None,
                MouseTracking::X10 => TrackingMode::X10,
                MouseTracking::Normal => TrackingMode::Normal,
                MouseTracking::Button => TrackingMode::Button,
                MouseTracking::Any => TrackingMode::Any,
            })
            .set_format(match modes.mouse_format {
                MouseFormat::X10 => Format::X10,
                MouseFormat::Utf8 => Format::Utf8,
                MouseFormat::Sgr => Format::Sgr,
                MouseFormat::Urxvt => Format::Urxvt,
                MouseFormat::SgrPixels => Format::SgrPixels,
            })
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

        let mut event = MouseEvent::new().context("mouse event init failed")?;
        event
            .set_action(match input.action {
                1 => MouseAction::Release,
                2 => MouseAction::Motion,
                _ => MouseAction::Press,
            })
            .set_button(input.button.and_then(|b| match b {
                0 => Some(Button::Left),
                1 => Some(Button::Middle),
                2 => Some(Button::Right),
                3 => Some(Button::Four),
                4 => Some(Button::Five),
                _ => None,
            }))
            .set_mods(parse_mods(input.mods))
            .set_position(Position {
                x: input.x,
                y: input.y,
            });

        let mut buf = Vec::new();
        encoder
            .encode_to_vec(&event, &mut buf)
            .context("mouse encode failed")?;
        if !buf.is_empty() {
            self.write(&buf)?;
        }
        Ok(())
    }
}

fn parse_mods(bits: u16) -> Mods {
    Mods::from_bits_truncate(bits) & (Mods::SHIFT | Mods::CTRL | Mods::ALT | Mods::SUPER)
}
