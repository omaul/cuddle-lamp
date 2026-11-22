/// Детерминированный генератор псевдослучайных чисел (SplitMix64).
///
/// Свой, а не из крейта, чтобы сцена с тем же сидом звучала одинаково при любых
/// обновлениях зависимостей.
#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut mixed = self.state;
        mixed = (mixed ^ (mixed >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        mixed = (mixed ^ (mixed >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        mixed ^ (mixed >> 31)
    }

    /// Возвращает число в диапазоне [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }

    pub fn range(&mut self, min: f32, max: f32) -> f32 {
        min + self.next_f32() * (max - min)
    }

    /// Возвращает число в диапазоне [-1, 1).
    pub fn bipolar(&mut self) -> f32 {
        self.next_f32() * 2.0 - 1.0
    }

    /// Возвращает индекс в диапазоне [0, `length`). `length` должен быть больше нуля.
    pub fn index(&mut self, length: usize) -> usize {
        ((self.next_u64() >> 11) % length as u64) as usize
    }

    pub fn chance(&mut self, probability: f32) -> bool {
        self.next_f32() < probability
    }

    /// Создаёт отдельный генератор для слоя.
    ///
    /// Слой берёт из своего генератора сколько угодно чисел и этим не сдвигает
    /// последовательность у остальных слоёв.
    pub fn fork(&mut self) -> Self {
        Self::new(self.next_u64())
    }
}
