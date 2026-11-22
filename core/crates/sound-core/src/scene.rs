use std::collections::BTreeMap;
use std::fmt;

use serde::{Deserialize, Serialize};

/// Описание сцены: гармония, слои, параметры сцены и ручки для пользователя.
///
/// Здесь только формат. Смысловую проверку (известные параметры, диапазоны, цели ручек)
/// делает загрузка сцены в движок.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub name: String,
    /// Сид случайности. Одинаковый сид даёт одинаковый звук.
    #[serde(default)]
    pub seed: u64,
    pub harmony: Harmony,
    /// Параметры сцены целиком: общее усиление и реверберация.
    #[serde(default)]
    pub params: BTreeMap<String, f32>,
    pub layers: Vec<LayerSpec>,
    #[serde(default)]
    pub knobs: Vec<KnobSpec>,
}

impl Scene {
    pub fn from_json(json: &str) -> Result<Self, SceneError> {
        serde_json::from_str(json).map_err(|error| SceneError::Format(error.to_string()))
    }
}

/// Гармония сцены, которой подчиняются все слои.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Harmony {
    /// Тоника в нотах MIDI: 60 — до первой октавы.
    pub root: i32,
    /// Ступени лада в полутонах от тоники.
    pub scale: Vec<i32>,
    /// Аккорды в полутонах от тоники. Пэд играет их на октаву ниже тоники.
    pub chords: Vec<Vec<i32>>,
    /// Сколько секунд держится аккорд: от и до.
    pub chord_seconds: [f32; 2],
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LayerSpec {
    Pad(SimpleLayerSpec),
    Noise(SimpleLayerSpec),
    Bells(BellsSpec),
}

impl LayerSpec {
    pub fn id(&self) -> &str {
        match self {
            Self::Pad(spec) | Self::Noise(spec) => &spec.id,
            Self::Bells(spec) => &spec.id,
        }
    }

    pub fn params(&self) -> &BTreeMap<String, f32> {
        match self {
            Self::Pad(spec) | Self::Noise(spec) => &spec.params,
            Self::Bells(spec) => &spec.params,
        }
    }
}

/// Слой, которому кроме числовых параметров ничего не нужно.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SimpleLayerSpec {
    pub id: String,
    #[serde(default)]
    pub params: BTreeMap<String, f32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BellsSpec {
    pub id: String,
    #[serde(default)]
    pub params: BTreeMap<String, f32>,
    /// Сдвиги нот в полутонах. Для каждого удара выбирается случайный.
    #[serde(default = "default_bell_octaves")]
    pub octaves: Vec<i32>,
}

/// Ручка, которую видит пользователь. Положение от 0 до 1 двигает сразу несколько параметров.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnobSpec {
    pub id: String,
    pub name: String,
    #[serde(default = "default_knob_position")]
    pub default: f32,
    pub targets: Vec<KnobTarget>,
}

/// Параметр, которым управляет ручка: значение в положении 0, значение в положении 1 и кривая между ними.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct KnobTarget {
    /// Адрес параметра: «идентификатор слоя.параметр» или «scene.параметр».
    pub param: String,
    pub from: f32,
    pub to: f32,
    #[serde(default)]
    pub curve: Curve,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Curve {
    #[default]
    Linear,
    /// Равные шаги ручки дают равные отношения значений. Подходит для частот и времён.
    Exponential,
}

impl Curve {
    pub fn interpolate(self, from: f32, to: f32, position: f32) -> f32 {
        match self {
            Self::Linear => from + (to - from) * position,
            Self::Exponential => from * (to / from).powf(position),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SceneError {
    /// JSON не соответствует формату сцены.
    Format(String),
    /// Формат верный, но содержимое противоречиво или вне допустимых значений.
    Invalid(String),
}

impl SceneError {
    pub(crate) fn invalid(message: impl Into<String>) -> Self {
        Self::Invalid(message.into())
    }
}

impl fmt::Display for SceneError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Format(message) => write!(formatter, "сцена не читается: {message}"),
            Self::Invalid(message) => write!(formatter, "сцена некорректна: {message}"),
        }
    }
}

impl std::error::Error for SceneError {}

fn default_bell_octaves() -> Vec<i32> {
    vec![12]
}

fn default_knob_position() -> f32 {
    0.5
}
