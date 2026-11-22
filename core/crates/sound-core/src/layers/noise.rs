use crate::dsp::{LowPass, Phase, sine};
use crate::params::{ParamSet, ParamSpec};
use crate::rng::Rng;

use super::LayerFrame;

pub const PARAMS: &[ParamSpec] = &[
    ParamSpec::new("level", 0.0, 1.0, 0.05, 0.5),
    ParamSpec::new("cutoff", 20.0, 8000.0, 700.0, 1.0),
    ParamSpec::new("waveDepth", 0.0, 1.0, 0.0, 1.0),
    ParamSpec::new("waveRate", 0.005, 1.0, 0.08, 1.0),
    ParamSpec::new("reverbSend", 0.0, 1.0, 0.0, 0.5),
];

const LEVEL: usize = 0;
const CUTOFF: usize = 1;
const WAVE_DEPTH: usize = 2;
const WAVE_RATE: usize = 3;
const REVERB_SEND: usize = 4;

const FILTER_RESONANCE: f32 = 0.707;
const BROWN_STEP: f32 = 0.02;
const BROWN_LEAK: f32 = 1.02;
/// Приводит коричневый шум к уровню, сопоставимому с остальными слоями.
const BROWN_GAIN: f32 = 3.5;

/// Коричневый шум через фильтр, громкость которого медленно колышется волной.
pub struct NoiseLayer {
    pub(super) params: ParamSet,
    rng: Rng,
    brown_left: f32,
    brown_right: f32,
    filter: LowPass,
    wave_phase: Phase,
    sample_rate: f32,
}

impl NoiseLayer {
    pub fn new(params: ParamSet, rng: Rng, sample_rate: f32) -> Self {
        Self {
            params,
            rng,
            brown_left: 0.0,
            brown_right: 0.0,
            filter: LowPass::default(),
            wave_phase: Phase::default(),
            sample_rate,
        }
    }

    #[inline]
    pub fn render(&mut self) -> LayerFrame {
        self.params.tick();
        self.brown_left = (self.brown_left + BROWN_STEP * self.rng.bipolar()) / BROWN_LEAK;
        self.brown_right = (self.brown_right + BROWN_STEP * self.rng.bipolar()) / BROWN_LEAK;

        self.filter.set(self.params.get(CUTOFF), FILTER_RESONANCE, self.sample_rate);
        let (left, right) = self.filter.process(self.brown_left * BROWN_GAIN, self.brown_right * BROWN_GAIN);

        let wave = sine(self.wave_phase.advance(self.params.get(WAVE_RATE) / self.sample_rate));
        let gain = (self.params.get(LEVEL) + self.params.get(WAVE_DEPTH) * wave).max(0.0);
        LayerFrame::with_send(left * gain, right * gain, self.params.get(REVERB_SEND))
    }
}
