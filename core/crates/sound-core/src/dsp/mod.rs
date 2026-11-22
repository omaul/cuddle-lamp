//! Строительные блоки синтеза. Все работают по одному отсчёту и не выделяют память.

mod dynamics;
mod filter;
mod oscillator;
mod reverb;
mod smoother;

use std::f32::consts::FRAC_PI_4;

pub use dynamics::{Compressor, soft_clip};
pub use filter::LowPass;
pub use oscillator::{Phase, saw_polyblep, sine, triangle};
pub use reverb::Reverb;
pub use smoother::Smoothed;

/// Возвращает усиления левого и правого канала для панорамы от -1 (лево) до 1 (право)
/// с сохранением громкости по центру.
pub fn pan_gains(pan: f32) -> (f32, f32) {
    let angle = (pan.clamp(-1.0, 1.0) + 1.0) * FRAC_PI_4;
    (angle.cos(), angle.sin())
}
