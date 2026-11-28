/// Значение, которое плавно догоняет целевое, чтобы изменения параметров не щёлкали.
#[derive(Clone, Debug)]
pub struct Smoothed {
    value: f32,
    target: f32,
    coefficient: f32,
}

impl Smoothed {
    pub fn new(value: f32, smoothing_seconds: f32, sample_rate: f32) -> Self {
        Self { value, target: value, coefficient: smoothing_coefficient(smoothing_seconds, sample_rate) }
    }

    pub fn set_target(&mut self, target: f32) {
        self.target = target;
        if self.coefficient >= 1.0 {
            self.value = target;
        }
    }

    pub fn set_immediate(&mut self, value: f32) {
        self.value = value;
        self.target = value;
    }

    pub fn finish(&mut self) {
        self.value = self.target;
    }

    /// Сдвигает значение на один отсчёт к целевому и возвращает его.
    #[inline]
    pub fn next(&mut self) -> f32 {
        if self.value != self.target {
            self.value += (self.target - self.value) * self.coefficient;
            if (self.target - self.value).abs() <= 1e-6 * self.target.abs().max(1.0) {
                self.value = self.target;
            }
        }
        self.value
    }

    #[inline]
    pub fn value(&self) -> f32 {
        self.value
    }
}

/// Возвращает коэффициент однополюсного сглаживания с постоянной времени `seconds`.
/// Ноль секунд даёт коэффициент 1, то есть мгновенное изменение.
pub fn smoothing_coefficient(seconds: f32, sample_rate: f32) -> f32 {
    if seconds <= 0.0 {
        return 1.0;
    }
    1.0 - (-1.0 / (seconds * sample_rate)).exp()
}
