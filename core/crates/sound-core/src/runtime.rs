use std::collections::{BTreeMap, HashSet};

use crate::layers::{BellNote, Layer, LayerFrame, MAX_CHORD_NOTES};
use crate::music::Conductor;
use crate::params::{ParamSet, ParamSpec, find_param};
use crate::rng::Rng;
use crate::scene::{Curve, Harmony, LayerSpec, Scene, SceneError, choice_index};

/// Параметры сцены целиком. В ручках адресуются как «scene.параметр».
pub const SCENE_PARAMS: &[ParamSpec] = &[
    ParamSpec::new("gain", 0.0, 4.0, 1.0, 0.5),
    ParamSpec::new("reverbDecay", 0.3, 20.0, 4.0, 0.0),
    ParamSpec::new("reverbDamping", 0.0, 1.0, 0.4, 0.0),
    ParamSpec::new("reverbLevel", 0.0, 2.0, 0.5, 0.0),
];

const GAIN: usize = 0;
const REVERB_DECAY: usize = 1;
const REVERB_DAMPING: usize = 2;
const REVERB_LEVEL: usize = 3;

/// Имя, под которым в адресах параметров записана сама сцена. Слою его взять нельзя.
const SCENE_OWNER: &str = "scene";

/// Настройки общей реверберации, которые просит сцена. Их сглаживает движок.
#[derive(Clone, Copy, Debug)]
pub struct ReverbSettings {
    pub decay_seconds: f32,
    pub damping: f32,
    pub level: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum ParamOwner {
    Scene,
    Layer(usize),
}

struct KnobTargetBinding {
    owner: ParamOwner,
    param_index: usize,
    mapping: KnobMapping,
}

enum KnobMapping {
    Range { from: f32, to: f32, curve: Curve },
    Choices(Vec<f32>),
}

impl KnobMapping {
    fn value(&self, position: f32) -> f32 {
        match self {
            Self::Range { from, to, curve } => curve.interpolate(*from, *to, position),
            Self::Choices(values) => values[choice_index(position, values.len())],
        }
    }
}

/// Загруженная сцена, готовая к синтезу. Создаётся вне аудиопотока, в аудиопотоке только играет.
pub struct SceneRuntime {
    harmony: Harmony,
    layers: Vec<Layer>,
    conductor: Conductor,
    rng: Rng,
    params: ParamSet,
    knobs: Vec<Vec<KnobTargetBinding>>,
    knob_defaults: Vec<f32>,
    sample_rate: f32,
}

impl SceneRuntime {
    /// Проверяет сцену и собирает её слои.
    ///
    /// # Errors
    ///
    /// Ошибка сцены с понятным автору описанием, что именно не так.
    pub fn new(scene: &Scene, sample_rate: f32, initial_knobs: &BTreeMap<String, f32>) -> Result<Self, SceneError> {
        validate_harmony(&scene.harmony)?;
        validate_layer_ids(scene)?;
        validate_notes(scene)?;

        let mut rng = Rng::new(scene.seed);
        let mut params = ParamSet::new(SCENE_PARAMS, &scene.params, "сцена", sample_rate)?;
        let mut layers = scene
            .layers
            .iter()
            .map(|spec| Layer::build(spec, rng.fork(), sample_rate))
            .collect::<Result<Vec<_>, _>>()?;
        let knobs = bind_knobs(scene)?;

        for (bindings, knob) in knobs.iter().zip(&scene.knobs) {
            let position = initial_knobs
                .get(&knob.id)
                .copied()
                .filter(|value| (0.0..=1.0).contains(value))
                .unwrap_or(knob.default);
            for binding in bindings {
                let value = binding.mapping.value(position);
                owner_params(&mut params, &mut layers, binding.owner).set_immediate(binding.param_index, value);
            }
        }

        Ok(Self {
            harmony: scene.harmony.clone(),
            layers,
            conductor: Conductor::new(),
            rng,
            params,
            knobs,
            knob_defaults: scene.knobs.iter().map(|knob| knob.default).collect(),
            sample_rate,
        })
    }

    /// Ставит ручку `index` в положение `position` от 0 до 1. Неизвестный индекс игнорируется.
    pub fn set_knob(&mut self, index: usize, position: f32, is_silent: bool) {
        if !position.is_finite() {
            return;
        }
        let position = position.clamp(0.0, 1.0);
        let Self { knobs, params, layers, .. } = self;
        let Some(bindings) = knobs.get(index) else {
            return;
        };
        for binding in bindings {
            let value = binding.mapping.value(position);
            let params = owner_params(params, layers, binding.owner);
            if is_silent && matches!(&binding.mapping, KnobMapping::Choices(_)) {
                params.set_immediate(binding.param_index, value);
            } else {
                params.set_target(binding.param_index, value);
            }
        }
    }

    pub fn reset_knobs(&mut self, is_silent: bool) {
        for index in 0..self.knob_defaults.len() {
            self.set_knob(index, self.knob_defaults[index], is_silent);
        }
    }

    /// Завершает перестройку пресетов, выбранных перед окончанием затухания.
    pub fn finish_choice_transitions(&mut self) {
        let Self { knobs, params, layers, .. } = self;
        for binding in knobs.iter().flatten() {
            if matches!(&binding.mapping, KnobMapping::Choices(_)) {
                owner_params(params, layers, binding.owner).finish(binding.param_index);
            }
        }
    }

    #[inline]
    pub fn render_frame(&mut self) -> LayerFrame {
        self.params.tick();
        if let Some(chord_index) = self.conductor.tick(&self.harmony, &mut self.rng, self.sample_rate) {
            let chord = &self.harmony.chords[chord_index];
            for layer in &mut self.layers {
                layer.start_chord(chord, &self.harmony);
            }
        }
        let mut frame = LayerFrame::default();
        for layer in &mut self.layers {
            frame += layer.render(&self.harmony);
        }
        frame.scaled(self.params.get(GAIN))
    }

    pub fn sounding_bells(&self) -> impl Iterator<Item = BellNote> + '_ {
        let gain = self.params.get(GAIN);
        self.layers
            .iter()
            .filter_map(|layer| match layer {
                Layer::Bells(bells) => Some(bells),
                _ => None,
            })
            .flat_map(|bells| bells.sounding_notes())
            .map(move |note| BellNote { level: note.level * gain, ..note })
    }

    pub fn reverb_settings(&self) -> ReverbSettings {
        ReverbSettings {
            decay_seconds: self.params.get(REVERB_DECAY),
            damping: self.params.get(REVERB_DAMPING),
            level: self.params.get(REVERB_LEVEL),
        }
    }
}

fn owner_params<'a>(params: &'a mut ParamSet, layers: &'a mut [Layer], owner: ParamOwner) -> &'a mut ParamSet {
    match owner {
        ParamOwner::Scene => params,
        ParamOwner::Layer(index) => layers[index].params_mut(),
    }
}

fn validate_harmony(harmony: &Harmony) -> Result<(), SceneError> {
    if harmony.scale.is_empty() {
        return Err(SceneError::invalid("гармония: лад scale пуст"));
    }
    if harmony.chords.is_empty() {
        return Err(SceneError::invalid("гармония: список аккордов chords пуст"));
    }
    if let Some(chord) = harmony.chords.iter().find(|chord| chord.is_empty() || chord.len() > MAX_CHORD_NOTES) {
        return Err(SceneError::invalid(format!(
            "гармония: в аккорде {chord:?} должно быть от 1 до {MAX_CHORD_NOTES} нот"
        )));
    }
    let [min_seconds, max_seconds] = harmony.chord_seconds;
    if !(min_seconds.is_finite() && max_seconds.is_finite() && min_seconds > 0.0 && min_seconds <= max_seconds) {
        return Err(SceneError::invalid(
            "гармония: chordSeconds должен быть парой положительных чисел, первое не больше второго",
        ));
    }
    Ok(())
}

fn validate_notes(scene: &Scene) -> Result<(), SceneError> {
    let harmony = &scene.harmony;
    let root = i64::from(harmony.root);
    let is_midi_note = |note| (0..=127).contains(&note);
    if !is_midi_note(root) {
        return Err(SceneError::invalid("гармония: root должен быть нотой MIDI от 0 до 127"));
    }
    for layer in &scene.layers {
        let valid = match layer {
            LayerSpec::Pad(_) => {
                harmony.chords.iter().flatten().all(|interval| is_midi_note(root - 12 + i64::from(*interval)))
            }
            LayerSpec::Bells(bells) => harmony.scale.iter().all(|degree| {
                bells.octaves.iter().all(|octave| is_midi_note(root + i64::from(*degree) + i64::from(*octave)))
            }),
            LayerSpec::Noise(_) | LayerSpec::Tone(_) => true,
        };
        if !valid {
            return Err(SceneError::invalid(format!(
                "слой «{}»: ноты выходят за диапазон MIDI от 0 до 127",
                layer.id()
            )));
        }
    }
    Ok(())
}

fn validate_layer_ids(scene: &Scene) -> Result<(), SceneError> {
    if scene.layers.is_empty() {
        return Err(SceneError::invalid("в сцене нет слоёв"));
    }
    let mut seen_ids = HashSet::new();
    for spec in &scene.layers {
        let id = spec.id();
        if id.is_empty() || id.contains('.') || id == SCENE_OWNER {
            return Err(SceneError::invalid(format!(
                "идентификатор слоя «{id}» недопустим: он не может быть пустым, содержать точку или быть «{SCENE_OWNER}»"
            )));
        }
        if !seen_ids.insert(id) {
            return Err(SceneError::invalid(format!("идентификатор слоя «{id}» повторяется")));
        }
    }
    Ok(())
}

/// Проверяет ручки сцены и переводит адреса параметров в индексы, чтобы в аудиопотоке не искать по строкам.
fn bind_knobs(scene: &Scene) -> Result<Vec<Vec<KnobTargetBinding>>, SceneError> {
    let mut seen_knob_ids = HashSet::new();
    let mut controlled_params = HashSet::new();
    let mut knobs = Vec::with_capacity(scene.knobs.len());

    for knob in &scene.knobs {
        let owner_name = format!("ручка «{}»", knob.id);
        if knob.id.is_empty() || !seen_knob_ids.insert(knob.id.as_str()) {
            return Err(SceneError::invalid(format!("{owner_name}: идентификатор пуст или повторяется")));
        }
        if !(0.0..=1.0).contains(&knob.default) {
            return Err(SceneError::invalid(format!("{owner_name}: положение по умолчанию должно быть от 0 до 1")));
        }
        match &knob.choices {
            Some(_) if !knob.targets.is_empty() => {
                return Err(SceneError::invalid(format!("{owner_name}: укажите либо targets, либо choices")));
            }
            None if knob.targets.is_empty() => {
                return Err(SceneError::invalid(format!("{owner_name}: не управляет ни одним параметром")));
            }
            _ => {}
        }

        let mappings = knob
            .targets
            .iter()
            .map(|target| {
                (target.param.as_str(), KnobMapping::Range { from: target.from, to: target.to, curve: target.curve })
            })
            .chain(
                knob.choices
                    .iter()
                    .map(|choices| (choices.param.as_str(), KnobMapping::Choices(choices.values.clone()))),
            );
        let mut bindings = Vec::new();
        for (param, mapping) in mappings {
            let Some((target_owner, param_name)) = param.split_once('.') else {
                return Err(SceneError::invalid(format!(
                    "{owner_name}: адрес «{param}» должен выглядеть как «слой.параметр»"
                )));
            };
            let (owner, specs, explicit_params) = if target_owner == SCENE_OWNER {
                (ParamOwner::Scene, SCENE_PARAMS, &scene.params)
            } else {
                let Some(layer_index) = scene.layers.iter().position(|spec| spec.id() == target_owner) else {
                    return Err(SceneError::invalid(format!("{owner_name}: слоя «{target_owner}» нет в сцене")));
                };
                let spec = &scene.layers[layer_index];
                (ParamOwner::Layer(layer_index), Layer::param_specs(spec), spec.params())
            };
            let Some(param_index) = find_param(specs, param_name) else {
                return Err(SceneError::invalid(format!(
                    "{owner_name}: у «{target_owner}» нет параметра «{param_name}»"
                )));
            };
            if explicit_params.contains_key(param_name) {
                return Err(SceneError::invalid(format!(
                    "параметр «{param}» задаёт ручка «{}», уберите его значение из параметров «{target_owner}»",
                    knob.id
                )));
            }
            if !controlled_params.insert((owner, param_index)) {
                return Err(SceneError::invalid(format!("параметром «{param}» управляют несколько ручек")));
            }
            let spec = &specs[param_index];
            match &mapping {
                KnobMapping::Range { from, to, curve } => {
                    spec.check(*from, &owner_name)?;
                    spec.check(*to, &owner_name)?;
                    if *curve == Curve::Exponential && (*from <= 0.0 || *to <= 0.0) {
                        return Err(SceneError::invalid(format!(
                            "{owner_name}: для экспоненциальной кривой у «{param}» нужны положительные from и to"
                        )));
                    }
                }
                KnobMapping::Choices(values) => {
                    let mut seen = HashSet::new();
                    if values.len() < 2 || !values.iter().all(|value| seen.insert((value + 0.0).to_bits())) {
                        return Err(SceneError::invalid(format!(
                            "{owner_name}: в choices.values нужны хотя бы два разных значения без повторений"
                        )));
                    }
                    for &value in values {
                        spec.check(value, &owner_name)?;
                    }
                }
            }
            bindings.push(KnobTargetBinding { owner, param_index, mapping });
        }
        knobs.push(bindings);
    }
    Ok(knobs)
}
