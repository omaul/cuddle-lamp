//! Слои — строительные блоки сцены. Каждый слой объявляет таблицу параметров
//! и выдаёт по одному стерео-отсчёту сухого сигнала и посыла в реверберацию.

mod bells;
mod noise;
mod pad;

use std::ops::AddAssign;

use crate::params::{ParamSet, ParamSpec};
use crate::rng::Rng;
use crate::scene::{Harmony, LayerSpec, SceneError};

use self::bells::BellsLayer;
pub use self::bells::{BellNote, VOICE_COUNT};
use self::noise::NoiseLayer;
use self::pad::PadLayer;

pub use self::pad::MAX_CHORD_NOTES;

/// Один стерео-отсчёт: сухой сигнал и посыл в реверберацию.
#[derive(Clone, Copy, Debug, Default)]
pub struct LayerFrame {
    pub dry_left: f32,
    pub dry_right: f32,
    pub send_left: f32,
    pub send_right: f32,
}

impl LayerFrame {
    /// Собирает отсчёт из сухого сигнала и доли, которая уходит в реверберацию.
    #[inline]
    pub fn with_send(left: f32, right: f32, send_amount: f32) -> Self {
        Self { dry_left: left, dry_right: right, send_left: left * send_amount, send_right: right * send_amount }
    }

    #[inline]
    pub fn scaled(self, gain: f32) -> Self {
        Self {
            dry_left: self.dry_left * gain,
            dry_right: self.dry_right * gain,
            send_left: self.send_left * gain,
            send_right: self.send_right * gain,
        }
    }
}

impl AddAssign for LayerFrame {
    #[inline]
    fn add_assign(&mut self, other: Self) {
        self.dry_left += other.dry_left;
        self.dry_right += other.dry_right;
        self.send_left += other.send_left;
        self.send_right += other.send_right;
    }
}

#[expect(
    clippy::large_enum_variant,
    reason = "слои создаются один раз и лежат в Vec подряд, а Box добавил бы переход по указателю на каждом отсчёте"
)]
pub enum Layer {
    Pad(PadLayer),
    Noise(NoiseLayer),
    Bells(BellsLayer),
}

impl Layer {
    /// Возвращает таблицу параметров слоя нужного типа.
    pub fn param_specs(spec: &LayerSpec) -> &'static [ParamSpec] {
        match spec {
            LayerSpec::Pad(_) => pad::PARAMS,
            LayerSpec::Noise(_) => noise::PARAMS,
            LayerSpec::Bells(_) => bells::PARAMS,
        }
    }

    /// Создаёт слой по описанию из сцены. Выделяет память, поэтому вызывается вне аудиопотока.
    pub fn build(spec: &LayerSpec, rng: Rng, sample_rate: f32) -> Result<Self, SceneError> {
        let owner = format!("слой «{}»", spec.id());
        let params = ParamSet::new(Self::param_specs(spec), spec.params(), &owner, sample_rate)?;
        let layer = match spec {
            LayerSpec::Pad(_) => Self::Pad(PadLayer::new(params, rng, sample_rate)),
            LayerSpec::Noise(_) => Self::Noise(NoiseLayer::new(params, rng, sample_rate)),
            LayerSpec::Bells(bells_spec) => {
                if bells_spec.octaves.is_empty() {
                    return Err(SceneError::invalid(format!("{owner}: список octaves пуст")));
                }
                Self::Bells(BellsLayer::new(params, bells_spec.octaves.clone(), rng, sample_rate))
            }
        };
        Ok(layer)
    }

    pub fn params_mut(&mut self) -> &mut ParamSet {
        match self {
            Self::Pad(layer) => &mut layer.params,
            Self::Noise(layer) => &mut layer.params,
            Self::Bells(layer) => &mut layer.params,
        }
    }

    /// Сообщает слою о смене аккорда. Пока на аккорды реагирует только пэд.
    pub fn start_chord(&mut self, chord: &[i32], harmony: &Harmony) {
        if let Self::Pad(layer) = self {
            layer.start_chord(chord, harmony);
        }
    }

    #[inline]
    pub fn render(&mut self, harmony: &Harmony) -> LayerFrame {
        match self {
            Self::Pad(layer) => layer.render(),
            Self::Noise(layer) => layer.render(),
            Self::Bells(layer) => layer.render(harmony),
        }
    }
}
