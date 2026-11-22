use crate::dsp::{Phase, pan_gains, sine};
use crate::music::midi_to_hz;
use crate::params::{ParamSet, ParamSpec};
use crate::rng::Rng;
use crate::scene::Harmony;

use super::LayerFrame;

pub const PARAMS: &[ParamSpec] = &[
    ParamSpec::new("level", 0.0, 1.0, 0.07, 0.5),
    ParamSpec::new("attack", 0.001, 5.0, 0.01, 0.0),
    ParamSpec::new("releaseMin", 0.1, 30.0, 2.5, 0.0),
    ParamSpec::new("releaseMax", 0.1, 30.0, 4.5, 0.0),
    ParamSpec::new("gapMin", 0.05, 60.0, 1.0, 0.0),
    ParamSpec::new("gapMax", 0.05, 60.0, 3.2, 0.0),
    ParamSpec::new("doubleChance", 0.0, 1.0, 0.3, 0.0),
    ParamSpec::new("overtone", 0.0, 1.0, 0.12, 0.0),
    ParamSpec::new("reverbSend", 0.0, 1.0, 0.9, 0.5),
];

const LEVEL: usize = 0;
const ATTACK: usize = 1;
const RELEASE_MIN: usize = 2;
const RELEASE_MAX: usize = 3;
const GAP_MIN: usize = 4;
const GAP_MAX: usize = 5;
const DOUBLE_CHANCE: usize = 6;
const OVERTONE: usize = 7;
const REVERB_SEND: usize = 8;

const VOICE_COUNT: usize = 24;
const FIRST_STRIKE_SECONDS: f32 = 1.2;
const SECOND_STRIKE_SECONDS: [f32; 2] = [0.25, 0.7];
const VELOCITY_RANGE: [f32; 2] = [0.5, 1.0];
const PAN_SPREAD: f32 = 0.7;
const OVERTONE_RATIO: f32 = 3.0;
/// Какую долю длительности удара звучит обертон.
const OVERTONE_DURATION_SHARE: f32 = 0.4;
/// Уровень, от которого стартует атака и до которого затухает удар.
const SILENCE: f32 = 0.0001;

/// Колокольчики: редкие удары по нотам лада со случайной октавой, громкостью и панорамой.
/// Иногда за ударом следует второй, как будто по колокольчику задели дважды.
pub struct BellsLayer {
    pub(super) params: ParamSet,
    octaves: Vec<i32>,
    voices: [BellVoice; VOICE_COUNT],
    rng: Rng,
    samples_until_strike: u64,
    samples_until_second_strike: Option<u64>,
    sample_counter: u64,
    sample_rate: f32,
}

#[derive(Clone, Copy, Default)]
struct BellVoice {
    is_active: bool,
    phase: Phase,
    overtone_phase: Phase,
    increment: f32,
    envelope: f32,
    attack_multiplier: f32,
    decay_multiplier: f32,
    attack_samples_left: u32,
    samples_left: u32,
    overtone_level: f32,
    overtone_multiplier: f32,
    left_gain: f32,
    right_gain: f32,
    started_at: u64,
}

impl BellsLayer {
    pub fn new(params: ParamSet, octaves: Vec<i32>, rng: Rng, sample_rate: f32) -> Self {
        Self {
            params,
            octaves,
            voices: [BellVoice::default(); VOICE_COUNT],
            rng,
            samples_until_strike: (FIRST_STRIKE_SECONDS * sample_rate) as u64,
            samples_until_second_strike: None,
            sample_counter: 0,
            sample_rate,
        }
    }

    #[inline]
    pub fn render(&mut self, harmony: &Harmony) -> LayerFrame {
        self.params.tick();
        self.sample_counter += 1;
        self.advance_schedule(harmony);

        let mut left = 0.0;
        let mut right = 0.0;
        for voice in self.voices.iter_mut().filter(|voice| voice.is_active) {
            let sample = voice.render();
            left += sample * voice.left_gain;
            right += sample * voice.right_gain;
        }
        let level = self.params.get(LEVEL);
        LayerFrame::with_send(left * level, right * level, self.params.get(REVERB_SEND))
    }

    fn advance_schedule(&mut self, harmony: &Harmony) {
        if self.samples_until_strike == 0 {
            self.strike(harmony);
            if self.rng.chance(self.params.get(DOUBLE_CHANCE)) {
                let [min_delay, max_delay] = SECOND_STRIKE_SECONDS;
                self.samples_until_second_strike =
                    Some((self.rng.range(min_delay, max_delay) * self.sample_rate) as u64);
            }
            let (min_gap, max_gap) = ordered(self.params.get(GAP_MIN), self.params.get(GAP_MAX));
            self.samples_until_strike = (self.rng.range(min_gap, max_gap) * self.sample_rate) as u64;
        } else {
            self.samples_until_strike -= 1;
        }

        match self.samples_until_second_strike {
            Some(0) => {
                self.strike(harmony);
                self.samples_until_second_strike = None;
            }
            Some(samples_left) => self.samples_until_second_strike = Some(samples_left - 1),
            None => {}
        }
    }

    fn strike(&mut self, harmony: &Harmony) {
        let degree = harmony.scale[self.rng.index(harmony.scale.len())];
        let octave = self.octaves[self.rng.index(self.octaves.len())];
        let frequency = midi_to_hz((i64::from(harmony.root) + i64::from(degree) + i64::from(octave)) as f32);
        let (min_release, max_release) = ordered(self.params.get(RELEASE_MIN), self.params.get(RELEASE_MAX));
        let duration = self.rng.range(min_release, max_release);
        let [min_velocity, max_velocity] = VELOCITY_RANGE;
        let velocity = self.rng.range(min_velocity, max_velocity);
        let (left_gain, right_gain) = pan_gains(self.rng.range(-PAN_SPREAD, PAN_SPREAD));

        let attack_samples = (self.params.get(ATTACK) * self.sample_rate).max(1.0);
        let decay_samples = (duration * self.sample_rate).max(1.0);
        let overtone_level = self.params.get(OVERTONE);
        let overtone_multiplier = if overtone_level > SILENCE {
            (SILENCE / overtone_level).powf(1.0 / (OVERTONE_DURATION_SHARE * decay_samples))
        } else {
            0.0
        };

        let voice_index = self.find_free_voice();
        self.voices[voice_index] = BellVoice {
            is_active: true,
            phase: Phase::default(),
            overtone_phase: Phase::default(),
            increment: frequency / self.sample_rate,
            envelope: SILENCE,
            attack_multiplier: (velocity / SILENCE).powf(1.0 / attack_samples),
            decay_multiplier: (SILENCE / velocity).powf(1.0 / decay_samples),
            attack_samples_left: attack_samples as u32,
            samples_left: (attack_samples + decay_samples) as u32,
            overtone_level,
            overtone_multiplier,
            left_gain,
            right_gain,
            started_at: self.sample_counter,
        };
    }

    /// Ищет свободный голос, а если все заняты — самый старый.
    fn find_free_voice(&self) -> usize {
        if let Some(index) = self.voices.iter().position(|voice| !voice.is_active) {
            return index;
        }
        self.voices.iter().enumerate().min_by_key(|(_, voice)| voice.started_at).map_or(0, |(index, _)| index)
    }
}

impl BellVoice {
    #[inline]
    fn render(&mut self) -> f32 {
        let fundamental = sine(self.phase.advance(self.increment));
        let overtone = sine(self.overtone_phase.advance(self.increment * OVERTONE_RATIO)) * self.overtone_level;
        let sample = (fundamental + overtone) * self.envelope;

        if self.attack_samples_left > 0 {
            self.envelope *= self.attack_multiplier;
            self.attack_samples_left -= 1;
        } else {
            self.envelope *= self.decay_multiplier;
        }
        self.overtone_level *= self.overtone_multiplier;
        self.samples_left = self.samples_left.saturating_sub(1);
        if self.samples_left == 0 {
            self.is_active = false;
        }
        sample
    }
}

fn ordered(first: f32, second: f32) -> (f32, f32) {
    if first <= second { (first, second) } else { (second, first) }
}
