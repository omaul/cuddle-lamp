//! Ядро генеративного звука: сцены, слои, синтез и состояние воспроизведения.
//!
//! Управляющая сторона ([`Controller`]) и аудиопоток ([`Processor`]) общаются через очереди
//! без блокировок, поэтому `Processor::render` можно вызывать из колбэка звуковой системы.

mod dsp;
mod engine;
mod layers;
mod music;
mod params;
mod rng;
mod runtime;
mod scene;

pub use engine::{
    Controller, EngineError, PAUSE_FADE_SECONDS, PLAY_FADE_SECONDS, PlaybackStatus, PlayerState, Processor,
    SCENE_CROSSFADE_SECONDS, SceneState, StateReader, TIMER_FADE_SECONDS, create,
};
pub use layers::BellNote;
pub use scene::{
    BellsSpec, Curve, Harmony, KnobChoices, KnobSpec, KnobTarget, LayerSpec, Scene, SceneError, SimpleLayerSpec,
};
