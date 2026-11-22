use std::f32::consts::TAU;

/// Фаза генератора в долях периода, от 0 до 1.
#[derive(Clone, Copy, Debug, Default)]
pub struct Phase {
    value: f32,
}

impl Phase {
    pub fn new(value: f32) -> Self {
        Self { value: value.rem_euclid(1.0) }
    }

    /// Сдвигает фазу на `increment` (частота, делённая на частоту дискретизации)
    /// и возвращает фазу до сдвига.
    #[inline]
    pub fn advance(&mut self, increment: f32) -> f32 {
        let current = self.value;
        self.value += increment;
        if self.value >= 1.0 {
            self.value -= 1.0;
        }
        current
    }
}

#[inline]
pub fn sine(phase: f32) -> f32 {
    (phase * TAU).sin()
}

/// Пила с поправкой PolyBLEP на скачке, чтобы высокие гармоники не заворачивались в слышимые призвуки.
#[inline]
pub fn saw_polyblep(phase: f32, increment: f32) -> f32 {
    2.0 * phase - 1.0 - polyblep(phase, increment)
}

#[inline]
pub fn triangle(phase: f32) -> f32 {
    1.0 - 4.0 * (phase - 0.5).abs()
}

#[inline]
fn polyblep(phase: f32, increment: f32) -> f32 {
    if phase < increment {
        let position = phase / increment;
        return position + position - position * position - 1.0;
    }
    if phase > 1.0 - increment {
        let position = (phase - 1.0) / increment;
        return position * position + position + position + 1.0;
    }
    0.0
}
