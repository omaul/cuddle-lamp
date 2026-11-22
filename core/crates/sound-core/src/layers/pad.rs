use crate::dsp::{LowPass, Phase, pan_gains, saw_polyblep, sine, triangle};
use crate::music::{cents_to_ratio, midi_to_hz};
use crate::params::{ParamSet, ParamSpec};
use crate::rng::Rng;
use crate::scene::Harmony;

use super::LayerFrame;

pub const PARAMS: &[ParamSpec] = &[
    ParamSpec::new("level", 0.0, 1.0, 0.12, 0.5),
    ParamSpec::new("cutoff", 40.0, 12_000.0, 1500.0, 1.0),
    ParamSpec::new("resonance", 0.3, 4.0, 0.707, 0.5),
    ParamSpec::new("cutoffLfoDepth", 0.0, 0.9, 0.35, 1.0),
    ParamSpec::new("cutoffLfoRate", 0.005, 2.0, 0.045, 1.0),
    ParamSpec::new("detune", 0.0, 50.0, 7.0, 0.5),
    ParamSpec::new("attack", 0.05, 30.0, 4.0, 0.0),
    ParamSpec::new("release", 0.05, 30.0, 6.0, 0.0),
    ParamSpec::new("reverbSend", 0.0, 1.0, 0.45, 0.5),
];

const LEVEL: usize = 0;
const CUTOFF: usize = 1;
const RESONANCE: usize = 2;
const CUTOFF_LFO_DEPTH: usize = 3;
const CUTOFF_LFO_RATE: usize = 4;
const DETUNE: usize = 5;
const ATTACK: usize = 6;
const RELEASE: usize = 7;
const REVERB_SEND: usize = 8;

pub const MAX_CHORD_NOTES: usize = 6;
/// Звучащий аккорд, затухающий предыдущий и запас на случай быстрой смены.
const CHORD_SLOTS: usize = 3;
const NOTE_GAIN: f32 = 0.22;
const NOTE_PANS: [f32; MAX_CHORD_NOTES] = [-0.5, 0.3, -0.2, 0.5, -0.35, 0.15];

/// Пэд: аккорд из пар расстроенных генераторов (пила и треугольник) через фильтр,
/// частота среза которого медленно «дышит». Новый аккорд плавно сменяет старый.
pub struct PadLayer {
    pub(super) params: ParamSet,
    slots: [ChordSlot; CHORD_SLOTS],
    filter: LowPass,
    lfo_phase: Phase,
    rng: Rng,
    sample_rate: f32,
}

#[derive(Clone, Copy, Default)]
struct ChordSlot {
    notes: [PadNote; MAX_CHORD_NOTES],
    note_count: usize,
    envelope: f32,
    envelope_step: f32,
    is_active: bool,
}

#[derive(Clone, Copy, Default)]
struct PadNote {
    frequency: f32,
    saw_phase: Phase,
    triangle_phase: Phase,
    left_gain: f32,
    right_gain: f32,
}

impl PadLayer {
    pub fn new(params: ParamSet, rng: Rng, sample_rate: f32) -> Self {
        Self {
            params,
            slots: [ChordSlot::default(); CHORD_SLOTS],
            filter: LowPass::default(),
            lfo_phase: Phase::default(),
            rng,
            sample_rate,
        }
    }

    pub fn start_chord(&mut self, chord: &[i32], harmony: &Harmony) {
        let release_samples = self.params.get(RELEASE) * self.sample_rate;
        for slot in self.slots.iter_mut().filter(|slot| slot.is_active && slot.envelope_step >= 0.0) {
            slot.envelope_step = -slot.envelope / release_samples;
        }

        let slot_index = self.find_free_slot();
        let attack_samples = self.params.get(ATTACK) * self.sample_rate;
        let slot = &mut self.slots[slot_index];
        slot.note_count = chord.len().min(MAX_CHORD_NOTES);
        for (note_index, interval) in chord.iter().take(MAX_CHORD_NOTES).enumerate() {
            let (left_gain, right_gain) = pan_gains(NOTE_PANS[note_index]);
            slot.notes[note_index] = PadNote {
                frequency: midi_to_hz((harmony.root - 12 + interval) as f32),
                saw_phase: Phase::new(self.rng.next_f32()),
                triangle_phase: Phase::new(self.rng.next_f32()),
                left_gain,
                right_gain,
            };
        }
        slot.envelope = 0.0;
        slot.envelope_step = 1.0 / attack_samples;
        slot.is_active = true;
    }

    #[inline]
    pub fn render(&mut self) -> LayerFrame {
        self.params.tick();
        let detune_ratio = cents_to_ratio(self.params.get(DETUNE));
        let saw_scale = 1.0 / (detune_ratio * self.sample_rate);
        let triangle_scale = detune_ratio / self.sample_rate;

        let mut left = 0.0;
        let mut right = 0.0;
        for slot in self.slots.iter_mut().filter(|slot| slot.is_active) {
            if !slot.advance_envelope() {
                continue;
            }
            for note in &mut slot.notes[..slot.note_count] {
                let saw_increment = note.frequency * saw_scale;
                let triangle_increment = note.frequency * triangle_scale;
                let saw = saw_polyblep(note.saw_phase.advance(saw_increment), saw_increment);
                let triangle_wave = triangle(note.triangle_phase.advance(triangle_increment));
                let sample = (saw + triangle_wave) * NOTE_GAIN * slot.envelope;
                left += sample * note.left_gain;
                right += sample * note.right_gain;
            }
        }

        let lfo = sine(self.lfo_phase.advance(self.params.get(CUTOFF_LFO_RATE) / self.sample_rate));
        let cutoff = self.params.get(CUTOFF) * (1.0 + self.params.get(CUTOFF_LFO_DEPTH) * lfo);
        self.filter.set(cutoff, self.params.get(RESONANCE), self.sample_rate);
        let (filtered_left, filtered_right) = self.filter.process(left, right);

        let level = self.params.get(LEVEL);
        LayerFrame::with_send(filtered_left * level, filtered_right * level, self.params.get(REVERB_SEND))
    }

    /// Ищет свободную ячейку, а если свободных нет — самую тихую.
    fn find_free_slot(&self) -> usize {
        if let Some(index) = self.slots.iter().position(|slot| !slot.is_active) {
            return index;
        }
        self.slots
            .iter()
            .enumerate()
            .min_by(|(_, first), (_, second)| first.envelope.total_cmp(&second.envelope))
            .map_or(0, |(index, _)| index)
    }
}

impl ChordSlot {
    /// Сдвигает огибающую на отсчёт. Возвращает `false`, если аккорд дозвучал и ячейка освободилась.
    #[inline]
    fn advance_envelope(&mut self) -> bool {
        self.envelope += self.envelope_step;
        if self.envelope_step > 0.0 && self.envelope >= 1.0 {
            self.envelope = 1.0;
            self.envelope_step = 0.0;
        }
        if self.envelope_step < 0.0 && self.envelope <= 0.0 {
            self.envelope = 0.0;
            self.is_active = false;
            return false;
        }
        true
    }
}
