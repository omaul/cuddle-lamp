use super::smoother::smoothing_coefficient;

const THRESHOLD_DB: f32 = -18.0;
const RATIO: f32 = 3.0;
const KNEE_DB: f32 = 6.0;
const ATTACK_SECONDS: f32 = 0.005;
const RELEASE_SECONDS: f32 = 0.3;
const SOFT_CLIP_START: f32 = 0.9;

/// Компрессор с общим для двух каналов детектором уровня.
///
/// Выравнивает громкость, чтобы наложение слоёв не перегружало выход. Возвращает усиление,
/// а не обработанный сигнал, чтобы после него можно было применить затухание и громкость.
pub struct Compressor {
    envelope: f32,
    attack_coefficient: f32,
    release_coefficient: f32,
}

impl Compressor {
    pub fn new(sample_rate: f32) -> Self {
        Self {
            envelope: 0.0,
            attack_coefficient: smoothing_coefficient(ATTACK_SECONDS, sample_rate),
            release_coefficient: smoothing_coefficient(RELEASE_SECONDS, sample_rate),
        }
    }

    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> f32 {
        let peak = left.abs().max(right.abs());
        let coefficient = if peak > self.envelope { self.attack_coefficient } else { self.release_coefficient };
        self.envelope += (peak - self.envelope) * coefficient;
        let level_db = 20.0 * self.envelope.max(1e-6).log10();
        10f32.powf(gain_reduction_db(level_db) / 20.0)
    }
}

/// Возвращает уменьшение усиления в децибелах (ноль или отрицательное) для уровня `level_db`.
fn gain_reduction_db(level_db: f32) -> f32 {
    let overshoot = level_db - THRESHOLD_DB;
    let slope = 1.0 / RATIO - 1.0;
    if 2.0 * overshoot < -KNEE_DB {
        return 0.0;
    }
    if 2.0 * overshoot.abs() <= KNEE_DB {
        let knee_position = overshoot + KNEE_DB / 2.0;
        return slope * knee_position * knee_position / (2.0 * KNEE_DB);
    }
    slope * overshoot
}

/// Мягко ограничивает сигнал, чтобы случайный пик не превратился в цифровой щелчок.
/// До 0.9 сигнал не меняется, выше плавно подходит к 1.
#[inline]
pub fn soft_clip(sample: f32) -> f32 {
    let magnitude = sample.abs();
    if magnitude <= SOFT_CLIP_START {
        return sample;
    }
    let headroom = 1.0 - SOFT_CLIP_START;
    sample.signum() * (SOFT_CLIP_START + headroom * ((magnitude - SOFT_CLIP_START) / headroom).tanh())
}
