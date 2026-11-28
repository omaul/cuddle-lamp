use super::LayerFrame;
use crate::dsp::{Phase, sine};
use crate::params::{ParamSet, ParamSpec};

pub const PARAMS: &[ParamSpec] =
    &[ParamSpec::new("frequencyHz", 20.0, 20_000.0, 528.0, 0.035), ParamSpec::new("level", 0.0, 1.0, 0.12, 0.04)];

const FREQUENCY: usize = 0;
const LEVEL: usize = 1;

pub struct ToneLayer {
    pub params: ParamSet,
    phase: Phase,
    sample_rate: f32,
}

impl ToneLayer {
    pub fn new(params: ParamSet, sample_rate: f32) -> Self {
        Self { params, phase: Phase::default(), sample_rate }
    }

    #[inline]
    pub fn render(&mut self) -> LayerFrame {
        self.params.tick();
        let increment = (self.params.get(FREQUENCY) / self.sample_rate).min(0.49);
        let sample = sine(self.phase.advance(increment)) * self.params.get(LEVEL);
        LayerFrame::with_send(sample, sample, 0.0)
    }
}
