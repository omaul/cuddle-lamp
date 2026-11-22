use std::collections::HashSet;

use crate::layers::{Layer, LayerFrame, MAX_CHORD_NOTES};
use crate::music::Conductor;
use crate::params::{ParamSet, ParamSpec, find_param};
use crate::rng::Rng;
use crate::scene::{Curve, Harmony, LayerSpec, Scene, SceneError};

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
    from: f32,
    to: f32,
    curve: Curve,
}

/// Загруженная сцена, готовая к синтезу. Создаётся вне аудиопотока, в аудиопотоке только играет.
pub struct SceneRuntime {
    harmony: Harmony,
    layers: Vec<Layer>,
    conductor: Conductor,
    rng: Rng,
    params: ParamSet,
    knobs: Vec<Vec<KnobTargetBinding>>,
    sample_rate: f32,
}

impl SceneRuntime {
    /// Проверяет сцену и собирает её слои.
    ///
    /// # Errors
    ///
    /// Ошибка сцены с понятным автору описанием, что именно не так.
    pub fn new(scene: &Scene, sample_rate: f32) -> Result<Self, SceneError> {
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
            for binding in bindings {
                let value = binding.curve.interpolate(binding.from, binding.to, knob.default);
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
            sample_rate,
        })
    }

    /// Ставит ручку `index` в положение `position` от 0 до 1. Неизвестный индекс игнорируется.
    pub fn set_knob(&mut self, index: usize, position: f32) {
        if !position.is_finite() {
            return;
        }
        let position = position.clamp(0.0, 1.0);
        let Self { knobs, params, layers, .. } = self;
        let Some(bindings) = knobs.get(index) else {
            return;
        };
        for binding in bindings {
            let value = binding.curve.interpolate(binding.from, binding.to, position);
            owner_params(params, layers, binding.owner).set_target(binding.param_index, value);
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
            LayerSpec::Noise(_) => true,
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
        if knob.targets.is_empty() {
            return Err(SceneError::invalid(format!("{owner_name}: не управляет ни одним параметром")));
        }

        let mut bindings = Vec::with_capacity(knob.targets.len());
        for target in &knob.targets {
            let Some((target_owner, param_name)) = target.param.split_once('.') else {
                return Err(SceneError::invalid(format!(
                    "{owner_name}: адрес «{}» должен выглядеть как «слой.параметр»",
                    target.param
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
                    "параметр «{}» задаёт ручка «{}», уберите его значение из параметров «{target_owner}»",
                    target.param, knob.id
                )));
            }
            if !controlled_params.insert((owner, param_index)) {
                return Err(SceneError::invalid(format!("параметром «{}» управляют несколько ручек", target.param)));
            }
            let spec = &specs[param_index];
            spec.check(target.from, &owner_name)?;
            spec.check(target.to, &owner_name)?;
            if target.curve == Curve::Exponential && (target.from <= 0.0 || target.to <= 0.0) {
                return Err(SceneError::invalid(format!(
                    "{owner_name}: для экспоненциальной кривой у «{}» нужны положительные from и to",
                    target.param
                )));
            }
            bindings.push(KnobTargetBinding {
                owner,
                param_index,
                from: target.from,
                to: target.to,
                curve: target.curve,
            });
        }
        knobs.push(bindings);
    }
    Ok(knobs)
}
