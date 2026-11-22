use crate::rng::Rng;
use crate::scene::Harmony;

pub fn midi_to_hz(note: f32) -> f32 {
    440.0 * 2f32.powf((note - 69.0) / 12.0)
}

pub fn cents_to_ratio(cents: f32) -> f32 {
    2f32.powf(cents / 1200.0)
}

/// Решает, когда сменить аккорд и какой взять следующим.
pub struct Conductor {
    samples_until_change: u64,
    chord_index: Option<usize>,
}

impl Conductor {
    /// Создаёт дирижёра, который возьмёт первый аккорд на первом же отсчёте.
    pub fn new() -> Self {
        Self { samples_until_change: 0, chord_index: None }
    }

    /// Продвигает время на один отсчёт и возвращает индекс нового аккорда,
    /// если на этом отсчёте аккорд сменился.
    pub fn tick(&mut self, harmony: &Harmony, rng: &mut Rng, sample_rate: f32) -> Option<usize> {
        if self.samples_until_change > 0 {
            self.samples_until_change -= 1;
            return None;
        }
        let chord_count = harmony.chords.len();
        let next_index = match self.chord_index {
            Some(current_index) if chord_count > 1 => (current_index + 1 + rng.index(chord_count - 1)) % chord_count,
            _ => rng.index(chord_count),
        };
        let [min_seconds, max_seconds] = harmony.chord_seconds;
        self.samples_until_change = (rng.range(min_seconds, max_seconds) * sample_rate) as u64;
        self.chord_index = Some(next_index);
        Some(next_index)
    }
}
