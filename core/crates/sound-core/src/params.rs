use std::collections::BTreeMap;

use crate::dsp::Smoothed;
use crate::scene::SceneError;

/// Описание числового параметра: имя в JSON сцены, допустимый диапазон, значение
/// по умолчанию и время сглаживания.
#[derive(Clone, Copy, Debug)]
pub struct ParamSpec {
    pub name: &'static str,
    pub min: f32,
    pub max: f32,
    pub default: f32,
    /// Время, за которое параметр догоняет новое значение. Ноль — меняется сразу.
    pub smoothing_seconds: f32,
}

impl ParamSpec {
    pub const fn new(name: &'static str, min: f32, max: f32, default: f32, smoothing_seconds: f32) -> Self {
        Self { name, min, max, default, smoothing_seconds }
    }

    /// Проверяет, что значение попадает в диапазон параметра. `owner` — кому принадлежит
    /// параметр, для текста ошибки.
    pub fn check(&self, value: f32, owner: &str) -> Result<(), SceneError> {
        if value.is_finite() && value >= self.min && value <= self.max {
            return Ok(());
        }
        Err(SceneError::invalid(format!(
            "{owner}: значение {value} параметра «{}» вне диапазона {}…{}",
            self.name, self.min, self.max
        )))
    }
}

pub fn find_param(specs: &[ParamSpec], name: &str) -> Option<usize> {
    specs.iter().position(|spec| spec.name == name)
}

/// Значения параметров одного владельца (слоя или сцены) в порядке таблицы описаний.
pub struct ParamSet {
    specs: &'static [ParamSpec],
    values: Vec<Smoothed>,
}

impl ParamSet {
    /// Создаёт набор со значениями по умолчанию и записывает поверх значения из сцены.
    /// `owner` — кому принадлежат параметры, для текста ошибки.
    ///
    /// # Errors
    ///
    /// Ошибка сцены, если параметр неизвестен или значение вне диапазона.
    pub fn new(
        specs: &'static [ParamSpec],
        overrides: &BTreeMap<String, f32>,
        owner: &str,
        sample_rate: f32,
    ) -> Result<Self, SceneError> {
        for (name, value) in overrides {
            let Some(index) = find_param(specs, name) else {
                return Err(SceneError::invalid(format!("{owner}: неизвестный параметр «{name}»")));
            };
            specs[index].check(*value, owner)?;
        }
        let values = specs
            .iter()
            .map(|spec| {
                let value = overrides.get(spec.name).copied().unwrap_or(spec.default);
                Smoothed::new(value, spec.smoothing_seconds, sample_rate)
            })
            .collect();
        Ok(Self { specs, values })
    }

    #[inline]
    pub fn get(&self, index: usize) -> f32 {
        self.values[index].value()
    }

    pub fn set_target(&mut self, index: usize, value: f32) {
        let spec = &self.specs[index];
        self.values[index].set_target(value.clamp(spec.min, spec.max));
    }

    pub fn set_immediate(&mut self, index: usize, value: f32) {
        let spec = &self.specs[index];
        self.values[index].set_immediate(value.clamp(spec.min, spec.max));
    }

    pub fn finish(&mut self, index: usize) {
        self.values[index].finish();
    }

    /// Сдвигает все параметры на один отсчёт к целевым значениям.
    #[inline]
    pub fn tick(&mut self) {
        for value in &mut self.values {
            value.next();
        }
    }
}
