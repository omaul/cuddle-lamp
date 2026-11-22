use std::f32::consts::{PI, TAU};

/// Стерео-фильтр нижних частот второго порядка на основе state variable filter.
///
/// Устойчив при быстрой модуляции частоты среза, поэтому подходит для «дышащего» пэда.
/// Пока не вызван [`LowPass::set`], на выходе тишина.
#[derive(Clone, Copy, Debug, Default)]
pub struct LowPass {
    a1: f32,
    a2: f32,
    a3: f32,
    left: FilterState,
    right: FilterState,
}

#[derive(Clone, Copy, Debug, Default)]
struct FilterState {
    first: f32,
    second: f32,
}

impl LowPass {
    pub fn set(&mut self, cutoff_hz: f32, resonance: f32, sample_rate: f32) {
        let cutoff = cutoff_hz.clamp(10.0, sample_rate * 0.45);
        let g = (PI * cutoff / sample_rate).tan();
        let k = 1.0 / resonance.max(0.1);
        self.a1 = 1.0 / (1.0 + g * (g + k));
        self.a2 = g * self.a1;
        self.a3 = g * self.a2;
    }

    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        let (a1, a2, a3) = (self.a1, self.a2, self.a3);
        (self.left.process(left, a1, a2, a3), self.right.process(right, a1, a2, a3))
    }
}

impl FilterState {
    #[inline]
    fn process(&mut self, input: f32, a1: f32, a2: f32, a3: f32) -> f32 {
        let v3 = input - self.second;
        let v1 = a1 * self.first + a2 * v3;
        let v2 = self.second + a2 * self.first + a3 * v3;
        self.first = 2.0 * v1 - self.first;
        self.second = 2.0 * v2 - self.second;
        v2
    }
}

/// Однополюсный фильтр нижних частот. Пока не вызван [`OnePole::set_cutoff`], на выходе тишина.
#[derive(Clone, Copy, Debug, Default)]
pub struct OnePole {
    state: f32,
    coefficient: f32,
}

impl OnePole {
    pub fn set_cutoff(&mut self, cutoff_hz: f32, sample_rate: f32) {
        self.coefficient = 1.0 - (-TAU * cutoff_hz / sample_rate).exp();
    }

    #[inline]
    pub fn process(&mut self, input: f32) -> f32 {
        self.state += (input - self.state) * self.coefficient;
        self.state
    }

    pub fn clear(&mut self) {
        self.state = 0.0;
    }
}
