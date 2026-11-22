use std::f32::consts::FRAC_PI_2;
use std::fmt;
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};

use crate::dsp::{Compressor, Reverb, Smoothed, soft_clip};
use crate::layers::LayerFrame;
use crate::runtime::SceneRuntime;
use crate::scene::{Scene, SceneError};

pub const PLAY_FADE_SECONDS: f32 = 2.5;
pub const PAUSE_FADE_SECONDS: f32 = 1.5;
pub const TIMER_FADE_SECONDS: f32 = 20.0;
pub const SCENE_CROSSFADE_SECONDS: f32 = 4.0;

const COMMAND_CAPACITY: usize = 256;
const GARBAGE_CAPACITY: usize = 8;
const STALLED_GARBAGE_SLOTS: usize = 4;
const VOLUME_SMOOTHING_SECONDS: f32 = 0.05;
/// Общее усиление после компрессора (+11 дБ). При `gain` сцены 1.0 громкость выхода
/// около −20 dBFS RMS, а пики остаются ниже −3 dBFS.
const OUTPUT_GAIN: f32 = 3.5;
/// Реверберация переходит к настройкам новой сцены не рывком, а за пару секунд.
const REVERB_SMOOTHING_SECONDS: f32 = 2.0;
const LEVEL_METER_SMOOTHING: f32 = 0.3;
const NO_TIMER: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum PlaybackStatus {
    /// Сцена ещё не загружена.
    Idle = 0,
    Paused = 1,
    /// Звук играет или плавно появляется.
    Playing = 2,
    /// Звук плавно затихает перед паузой.
    Stopping = 3,
}

impl PlaybackStatus {
    fn from_u8(value: u8) -> Self {
        match value {
            1 => Self::Paused,
            2 => Self::Playing,
            3 => Self::Stopping,
            _ => Self::Idle,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PlayerState {
    pub status: PlaybackStatus,
    /// Сколько секунд осталось до срабатывания таймера, если он включён.
    pub timer_remaining_seconds: Option<f32>,
    /// Сглаженная громкость выхода (RMS), например для анимации.
    pub level: f32,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EngineError {
    Scene(SceneError),
    UnknownKnob(String),
    /// Аудиопоток не забирает команды: звуковая система остановлена или не успевает.
    QueueFull,
    /// Сторона аудиопотока уничтожена.
    ProcessorGone,
}

impl fmt::Display for EngineError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Scene(error) => error.fmt(formatter),
            Self::UnknownKnob(knob_id) => write!(formatter, "в текущей сцене нет ручки «{knob_id}»"),
            Self::QueueFull => write!(formatter, "очередь команд переполнена, аудиопоток их не забирает"),
            Self::ProcessorGone => write!(formatter, "аудиопоток движка уже уничтожен"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<SceneError> for EngineError {
    fn from(error: SceneError) -> Self {
        Self::Scene(error)
    }
}

enum Command {
    LoadScene(Box<SceneRuntime>),
    Play,
    Pause,
    SetKnob { index: usize, position: f32 },
    SetTimer(Option<f32>),
}

struct SharedState {
    status: AtomicU8,
    timer_remaining_milliseconds: AtomicU32,
    level: AtomicU32,
    volume: AtomicU32,
}

/// Читает состояние плеера из любого потока.
#[derive(Clone)]
pub struct StateReader {
    shared: Arc<SharedState>,
}

impl StateReader {
    pub fn state(&self) -> PlayerState {
        let timer_milliseconds = self.shared.timer_remaining_milliseconds.load(Ordering::Relaxed);
        PlayerState {
            status: PlaybackStatus::from_u8(self.shared.status.load(Ordering::Relaxed)),
            timer_remaining_seconds: (timer_milliseconds != NO_TIMER).then(|| timer_milliseconds as f32 / 1000.0),
            level: f32::from_bits(self.shared.level.load(Ordering::Relaxed)),
        }
    }
}

/// Создаёт связанную пару: управляющую сторону и сторону аудиопотока.
pub fn create(sample_rate: f32) -> (Controller, Processor) {
    let (command_sender, command_receiver) = mpsc::sync_channel(COMMAND_CAPACITY);
    let (garbage_sender, garbage_receiver) = mpsc::sync_channel(GARBAGE_CAPACITY);
    let shared = Arc::new(SharedState {
        status: AtomicU8::new(PlaybackStatus::Idle as u8),
        timer_remaining_milliseconds: AtomicU32::new(NO_TIMER),
        level: AtomicU32::new(0f32.to_bits()),
        volume: AtomicU32::new(1f32.to_bits()),
    });

    let controller = Controller {
        commands: command_sender,
        garbage: garbage_receiver,
        state: StateReader { shared: Arc::clone(&shared) },
        sample_rate,
        knob_ids: Vec::new(),
    };
    let processor = Processor {
        commands: command_receiver,
        garbage: garbage_sender,
        stalled_garbage: std::array::from_fn(|_| None),
        shared,
        sample_rate,
        status: PlaybackStatus::Idle,
        current: None,
        outgoing: None,
        crossfade_position: 1.0,
        crossfade_step: 1.0 / (SCENE_CROSSFADE_SECONDS * sample_rate),
        transport_gain: 0.0,
        transport_step: 0.0,
        timer_samples_left: None,
        reverb: Reverb::new(sample_rate),
        reverb_decay: Smoothed::new(4.0, REVERB_SMOOTHING_SECONDS, sample_rate),
        reverb_damping: Smoothed::new(0.4, REVERB_SMOOTHING_SECONDS, sample_rate),
        reverb_level: Smoothed::new(0.5, REVERB_SMOOTHING_SECONDS, sample_rate),
        compressor: Compressor::new(sample_rate),
        volume: Smoothed::new(1.0, VOLUME_SMOOTHING_SECONDS, sample_rate),
        level: 0.0,
    };
    (controller, processor)
}

/// Управляющая сторона движка. Вызывается из одного потока, не из аудиопотока:
/// загрузка сцены выделяет память.
pub struct Controller {
    commands: SyncSender<Command>,
    garbage: Receiver<Box<SceneRuntime>>,
    state: StateReader,
    sample_rate: f32,
    knob_ids: Vec<String>,
}

impl Controller {
    /// Проверяет сцену, собирает её и передаёт в аудиопоток. Если звук играет,
    /// новая сцена плавно сменяет старую.
    pub fn load_scene(&mut self, scene: &Scene) -> Result<(), EngineError> {
        let runtime = SceneRuntime::new(scene, self.sample_rate)?;
        self.send(Command::LoadScene(Box::new(runtime)))?;
        self.knob_ids = scene.knobs.iter().map(|knob| knob.id.clone()).collect();
        Ok(())
    }

    pub fn load_scene_json(&mut self, json: &str) -> Result<(), EngineError> {
        let scene = Scene::from_json(json)?;
        self.load_scene(&scene)
    }

    /// Запускает звук с плавным появлением. Без загруженной сцены ничего не делает.
    pub fn play(&mut self) -> Result<(), EngineError> {
        self.send(Command::Play)
    }

    pub fn pause(&mut self) -> Result<(), EngineError> {
        self.send(Command::Pause)
    }

    /// Ставит ручку текущей сцены в положение от 0 до 1.
    pub fn set_knob(&mut self, knob_id: &str, position: f32) -> Result<(), EngineError> {
        let Some(index) = self.knob_ids.iter().position(|id| id == knob_id) else {
            return Err(EngineError::UnknownKnob(knob_id.to_owned()));
        };
        self.send(Command::SetKnob { index, position })
    }

    /// Включает таймер: через `seconds` секунд игры звук плавно затихнет и встанет на паузу.
    /// `None` выключает таймер.
    pub fn set_timer(&mut self, seconds: Option<f32>) -> Result<(), EngineError> {
        self.send(Command::SetTimer(seconds))
    }

    /// Задаёт общую громкость от 0 до 1. Применяется, даже если аудиопоток стоит.
    pub fn set_volume(&self, volume: f32) {
        let volume = if volume.is_finite() { volume.clamp(0.0, 1.0) } else { 0.0 };
        self.state.shared.volume.store(volume.to_bits(), Ordering::Relaxed);
    }

    pub fn state(&self) -> PlayerState {
        self.state.state()
    }

    pub fn state_reader(&self) -> StateReader {
        self.state.clone()
    }

    fn send(&mut self, command: Command) -> Result<(), EngineError> {
        self.collect_garbage();
        self.commands.try_send(command).map_err(|error| match error {
            TrySendError::Full(_) => EngineError::QueueFull,
            TrySendError::Disconnected(_) => EngineError::ProcessorGone,
        })
    }

    /// Освобождает сцены, которые аудиопоток вернул после смены. Освобождать их в аудиопотоке нельзя.
    fn collect_garbage(&mut self) {
        while self.garbage.try_recv().is_ok() {}
    }
}

/// Сторона аудиопотока. [`Processor::render`] не выделяет память и не берёт блокировок.
pub struct Processor {
    commands: Receiver<Command>,
    garbage: SyncSender<Box<SceneRuntime>>,
    stalled_garbage: [Option<Box<SceneRuntime>>; STALLED_GARBAGE_SLOTS],
    shared: Arc<SharedState>,
    sample_rate: f32,
    status: PlaybackStatus,
    current: Option<Box<SceneRuntime>>,
    outgoing: Option<Box<SceneRuntime>>,
    crossfade_position: f32,
    crossfade_step: f32,
    transport_gain: f32,
    transport_step: f32,
    timer_samples_left: Option<u64>,
    reverb: Reverb,
    reverb_decay: Smoothed,
    reverb_damping: Smoothed,
    reverb_level: Smoothed,
    compressor: Compressor,
    volume: Smoothed,
    level: f32,
}

impl Processor {
    /// Заполняет буферы следующими отсчётами. Длина блока любая, результат от неё не зависит.
    pub fn render(&mut self, left: &mut [f32], right: &mut [f32]) {
        let frame_count = left.len().min(right.len());
        let (left, right) = (&mut left[..frame_count], &mut right[..frame_count]);
        self.handle_commands();
        self.release_stalled_garbage();
        self.volume.set_target(f32::from_bits(self.shared.volume.load(Ordering::Relaxed)));

        let mut sum_of_squares = 0.0;
        for (left_sample, right_sample) in left.iter_mut().zip(right.iter_mut()) {
            if !self.is_audible() {
                *left_sample = 0.0;
                *right_sample = 0.0;
                continue;
            }
            let (left_value, right_value) = self.render_frame();
            *left_sample = left_value;
            *right_sample = right_value;
            sum_of_squares += left_value * left_value + right_value * right_value;
        }
        self.publish_state(sum_of_squares, frame_count);
    }

    fn is_audible(&self) -> bool {
        matches!(self.status, PlaybackStatus::Playing | PlaybackStatus::Stopping)
    }

    fn handle_commands(&mut self) {
        while let Ok(command) = self.commands.try_recv() {
            match command {
                Command::LoadScene(runtime) => self.load(runtime),
                Command::Play => self.start_playing(),
                Command::Pause => self.begin_stopping(PAUSE_FADE_SECONDS),
                Command::SetKnob { index, position } => {
                    if let Some(current) = self.current.as_mut() {
                        current.set_knob(index, position);
                    }
                }
                Command::SetTimer(seconds) => {
                    self.timer_samples_left = seconds
                        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
                        .map(|seconds| (seconds * self.sample_rate) as u64);
                }
            }
        }
    }

    fn load(&mut self, runtime: Box<SceneRuntime>) {
        if self.is_audible() && self.current.is_some() {
            if let Some(previous) = self.outgoing.take() {
                self.dispose(previous);
            }
            self.outgoing = self.current.replace(runtime);
            self.crossfade_position = 0.0;
            return;
        }

        // Звук стоит, поэтому хвост прошлой сцены не нужен, а реверберация сразу берёт новые настройки
        self.reverb.clear();
        let settings = runtime.reverb_settings();
        self.reverb_decay.set_immediate(settings.decay_seconds);
        self.reverb_damping.set_immediate(settings.damping);
        self.reverb_level.set_immediate(settings.level);
        if let Some(previous) = self.current.replace(runtime) {
            self.dispose(previous);
        }
        if let Some(previous) = self.outgoing.take() {
            self.dispose(previous);
        }
        self.crossfade_position = 1.0;
        if self.status == PlaybackStatus::Idle {
            self.status = PlaybackStatus::Paused;
        }
    }

    fn start_playing(&mut self) {
        if self.current.is_none() {
            return;
        }
        self.status = PlaybackStatus::Playing;
        self.transport_step = 1.0 / (PLAY_FADE_SECONDS * self.sample_rate);
    }

    fn begin_stopping(&mut self, fade_seconds: f32) {
        if !self.is_audible() {
            return;
        }
        self.status = PlaybackStatus::Stopping;
        self.transport_step = -1.0 / (fade_seconds * self.sample_rate);
    }

    #[inline]
    fn render_frame(&mut self) -> (f32, f32) {
        let Some(current) = self.current.as_mut() else {
            return (0.0, 0.0);
        };
        let mut frame = current.render_frame();
        let settings = current.reverb_settings();
        if let Some(outgoing) = self.outgoing.as_mut() {
            let outgoing_frame = outgoing.render_frame();
            self.crossfade_position = (self.crossfade_position + self.crossfade_step).min(1.0);
            let angle = self.crossfade_position * FRAC_PI_2;
            frame = frame.scaled(angle.sin());
            frame += outgoing_frame.scaled(angle.cos());
            if self.crossfade_position >= 1.0
                && let Some(finished) = self.outgoing.take()
            {
                self.dispose(finished);
            }
        }

        let wet = self.render_reverb(&frame, settings.decay_seconds, settings.damping, settings.level);
        let mixed_left = frame.dry_left + wet.0;
        let mixed_right = frame.dry_right + wet.1;
        let compressor_gain = self.compressor.process(mixed_left, mixed_right);
        self.advance_transport();
        // Квадрат даёт плавное по слуху затухание: линейный спад громкости в конце звучит обрывисто
        let transport = self.transport_gain * self.transport_gain;
        let gain = compressor_gain * OUTPUT_GAIN * transport * self.volume.next();
        (soft_clip(mixed_left * gain), soft_clip(mixed_right * gain))
    }

    #[inline]
    fn render_reverb(&mut self, frame: &LayerFrame, decay_seconds: f32, damping: f32, level: f32) -> (f32, f32) {
        self.reverb_decay.set_target(decay_seconds);
        self.reverb_damping.set_target(damping);
        self.reverb_level.set_target(level);
        self.reverb.set_decay(self.reverb_decay.next());
        self.reverb.set_damping(self.reverb_damping.next());
        let wet_level = self.reverb_level.next();
        let (wet_left, wet_right) = self.reverb.process(frame.send_left, frame.send_right);
        (wet_left * wet_level, wet_right * wet_level)
    }

    #[inline]
    fn advance_transport(&mut self) {
        if self.transport_step != 0.0 {
            self.transport_gain = (self.transport_gain + self.transport_step).clamp(0.0, 1.0);
            if self.transport_step > 0.0 && self.transport_gain >= 1.0 {
                self.transport_step = 0.0;
            } else if self.transport_step < 0.0 && self.transport_gain <= 0.0 {
                self.transport_step = 0.0;
                self.status = PlaybackStatus::Paused;
            }
        }
        if self.status != PlaybackStatus::Playing {
            return;
        }
        match self.timer_samples_left {
            Some(0) => {
                self.timer_samples_left = None;
                self.begin_stopping(TIMER_FADE_SECONDS);
            }
            Some(samples_left) => self.timer_samples_left = Some(samples_left - 1),
            None => {}
        }
    }

    /// Отдаёт отыгравшую сцену управляющей стороне, чтобы память освободилась вне аудиопотока.
    fn dispose(&mut self, runtime: Box<SceneRuntime>) {
        let Err(TrySendError::Full(runtime) | TrySendError::Disconnected(runtime)) = self.garbage.try_send(runtime)
        else {
            return;
        };
        if let Some(slot) = self.stalled_garbage.iter_mut().find(|slot| slot.is_none()) {
            *slot = Some(runtime);
        }
        // Если и запасные ячейки заняты, сцена освобождается здесь: редкая пауза лучше утечки
    }

    fn release_stalled_garbage(&mut self) {
        for slot in &mut self.stalled_garbage {
            let Some(runtime) = slot.take() else {
                continue;
            };
            if let Err(TrySendError::Full(runtime) | TrySendError::Disconnected(runtime)) =
                self.garbage.try_send(runtime)
            {
                *slot = Some(runtime);
                return;
            }
        }
    }

    fn publish_state(&mut self, sum_of_squares: f32, frame_count: usize) {
        let rms = if frame_count > 0 { (sum_of_squares / (2 * frame_count) as f32).sqrt() } else { 0.0 };
        self.level += (rms - self.level) * LEVEL_METER_SMOOTHING;
        let timer_milliseconds = self.timer_samples_left.map_or(NO_TIMER, |samples| {
            ((samples as f64 / f64::from(self.sample_rate)) * 1000.0).min(f64::from(NO_TIMER - 1)) as u32
        });
        self.shared.status.store(self.status as u8, Ordering::Relaxed);
        self.shared.timer_remaining_milliseconds.store(timer_milliseconds, Ordering::Relaxed);
        self.shared.level.store(self.level.to_bits(), Ordering::Relaxed);
    }
}
