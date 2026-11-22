use super::filter::OnePole;

const LINE_COUNT: usize = 8;
const LINE_MILLISECONDS: [f32; LINE_COUNT] = [31.7, 37.3, 41.9, 47.3, 53.9, 61.1, 67.9, 79.3];
const DIFFUSER_COUNT: usize = 4;
const DIFFUSER_MILLISECONDS: [f32; DIFFUSER_COUNT] = [4.7, 3.6, 2.5, 1.7];
/// Правые диффузоры чуть длиннее левых, чтобы каналы не звучали одинаково.
const RIGHT_DIFFUSER_STRETCH: f32 = 1.13;
const DIFFUSER_GAIN: f32 = 0.6;
const INPUT_GAIN: f32 = 0.5;
const OUTPUT_GAIN: f32 = 0.5;
/// Как часто пересчитывать коэффициенты затухания. Считаем по внутреннему счётчику отсчётов,
/// чтобы результат не зависел от размера блока, который просит звуковая система.
const COEFFICIENT_UPDATE_INTERVAL: u32 = 32;
const MIN_DECAY_SECONDS: f32 = 0.1;
const DAMPING_MAX_CUTOFF_HZ: f32 = 18_000.0;
/// Во сколько раз падает частота среза в петле при полном демпфировании.
const DAMPING_MIN_RATIO: f32 = 0.05;

/// Реверберация на сети задержек с обратной связью (FDN): восемь линий, смешанных матрицей
/// Адамара, и диффузоры на входе, чтобы короткие удары колокольчиков не звучали зернисто.
pub struct Reverb {
    lines: [DelayLine; LINE_COUNT],
    line_seconds: [f32; LINE_COUNT],
    feedback_gains: [f32; LINE_COUNT],
    damping_filters: [OnePole; LINE_COUNT],
    left_diffusers: [Allpass; DIFFUSER_COUNT],
    right_diffusers: [Allpass; DIFFUSER_COUNT],
    decay_seconds: f32,
    damping: f32,
    sample_rate: f32,
    samples_until_update: u32,
}

impl Reverb {
    /// Создаёт реверберацию и выделяет буферы задержек. Вызывать вне аудиопотока.
    pub fn new(sample_rate: f32) -> Self {
        let to_samples = |milliseconds: f32| (milliseconds * sample_rate / 1000.0).round() as usize;
        let mut reverb = Self {
            lines: std::array::from_fn(|index| DelayLine::new(to_samples(LINE_MILLISECONDS[index]))),
            line_seconds: std::array::from_fn(|index| to_samples(LINE_MILLISECONDS[index]).max(1) as f32 / sample_rate),
            feedback_gains: [0.0; LINE_COUNT],
            damping_filters: [OnePole::default(); LINE_COUNT],
            left_diffusers: std::array::from_fn(|index| Allpass::new(to_samples(DIFFUSER_MILLISECONDS[index]))),
            right_diffusers: std::array::from_fn(|index| {
                Allpass::new(to_samples(DIFFUSER_MILLISECONDS[index] * RIGHT_DIFFUSER_STRETCH))
            }),
            decay_seconds: 4.0,
            damping: 0.4,
            sample_rate,
            samples_until_update: 0,
        };
        reverb.update_coefficients();
        reverb
    }

    /// Задаёт время, за которое хвост затухает на 60 дБ.
    pub fn set_decay(&mut self, seconds: f32) {
        self.decay_seconds = seconds.max(MIN_DECAY_SECONDS);
    }

    /// Задаёт демпфирование высоких частот в хвосте: 0 — ярко, 1 — глухо.
    pub fn set_damping(&mut self, amount: f32) {
        self.damping = amount.clamp(0.0, 1.0);
    }

    pub fn clear(&mut self) {
        for line in &mut self.lines {
            line.clear();
        }
        for diffuser in self.left_diffusers.iter_mut().chain(self.right_diffusers.iter_mut()) {
            diffuser.line.clear();
        }
        for filter in &mut self.damping_filters {
            filter.clear();
        }
    }

    #[inline]
    pub fn process(&mut self, left: f32, right: f32) -> (f32, f32) {
        if self.samples_until_update == 0 {
            self.update_coefficients();
            self.samples_until_update = COEFFICIENT_UPDATE_INTERVAL;
        }
        self.samples_until_update -= 1;

        let diffused_left = self.left_diffusers.iter_mut().fold(left, |signal, diffuser| diffuser.process(signal));
        let diffused_right = self.right_diffusers.iter_mut().fold(right, |signal, diffuser| diffuser.process(signal));

        let outputs: [f32; LINE_COUNT] = std::array::from_fn(|index| self.lines[index].read());
        let mut mixed = outputs;
        hadamard(&mut mixed);

        for (index, line) in self.lines.iter_mut().enumerate() {
            let input = if index % 2 == 0 { diffused_left } else { diffused_right };
            let mut feedback = self.damping_filters[index].process(mixed[index]) * self.feedback_gains[index];
            // Затухающий хвост уходит в денормализованные числа, а они резко замедляют вычисления
            if feedback.abs() < 1e-18 {
                feedback = 0.0;
            }
            line.write_and_advance(feedback + input * INPUT_GAIN);
        }

        let wet_left = (outputs[0] - outputs[2] + outputs[4] - outputs[6]) * OUTPUT_GAIN;
        let wet_right = (outputs[1] - outputs[3] + outputs[5] - outputs[7]) * OUTPUT_GAIN;
        (wet_left, wet_right)
    }

    fn update_coefficients(&mut self) {
        for (gain, seconds) in self.feedback_gains.iter_mut().zip(self.line_seconds) {
            *gain = 10f32.powf(-3.0 * seconds / self.decay_seconds);
        }
        let cutoff = DAMPING_MAX_CUTOFF_HZ * DAMPING_MIN_RATIO.powf(self.damping);
        for filter in &mut self.damping_filters {
            filter.set_cutoff(cutoff, self.sample_rate);
        }
    }
}

struct DelayLine {
    buffer: Vec<f32>,
    position: usize,
}

impl DelayLine {
    fn new(length: usize) -> Self {
        Self { buffer: vec![0.0; length.max(1)], position: 0 }
    }

    #[inline]
    fn read(&self) -> f32 {
        self.buffer[self.position]
    }

    #[inline]
    fn write_and_advance(&mut self, value: f32) {
        self.buffer[self.position] = value;
        self.position += 1;
        if self.position == self.buffer.len() {
            self.position = 0;
        }
    }

    fn clear(&mut self) {
        self.buffer.fill(0.0);
    }
}

/// Всепропускающий фильтр Шрёдера: размазывает удар во времени, не меняя тембр.
struct Allpass {
    line: DelayLine,
}

impl Allpass {
    fn new(length: usize) -> Self {
        Self { line: DelayLine::new(length) }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let delayed = self.line.read();
        let written = input + DIFFUSER_GAIN * delayed;
        self.line.write_and_advance(written);
        delayed - DIFFUSER_GAIN * written
    }
}

/// Нормированное преобразование Адамара: смешивает линии, сохраняя энергию.
#[inline]
fn hadamard(values: &mut [f32; LINE_COUNT]) {
    let mut half = 1;
    while half < LINE_COUNT {
        for start in (0..LINE_COUNT).step_by(half * 2) {
            for index in start..start + half {
                let (first, second) = (values[index], values[index + half]);
                values[index] = first + second;
                values[index + half] = first - second;
            }
        }
        half *= 2;
    }
    let normalization = 1.0 / (LINE_COUNT as f32).sqrt();
    for value in values.iter_mut() {
        *value *= normalization;
    }
}
