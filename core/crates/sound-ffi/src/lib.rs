//! C-интерфейс ядра для C++ Turbo Module и платформенного кода. Заголовок — `include/sound_engine.h`.
//!
//! Функции управления вызываются из одного потока или под внешней синхронизацией,
//! `sound_engine_render` — только из аудиопотока, `sound_engine_get_state` — из любого потока.

use std::cell::UnsafeCell;
use std::ffi::{CStr, CString, c_char};
use std::slice;

use sound_core::{Controller, EngineError, Processor, StateReader, create};

pub const SOUND_ENGINE_OK: i32 = 0;
pub const SOUND_ENGINE_ERROR_INVALID_ARGUMENT: i32 = 1;
pub const SOUND_ENGINE_ERROR_SCENE: i32 = 2;
pub const SOUND_ENGINE_ERROR_UNKNOWN_KNOB: i32 = 3;
pub const SOUND_ENGINE_ERROR_QUEUE_FULL: i32 = 4;
pub const SOUND_ENGINE_ERROR_PROCESSOR_GONE: i32 = 5;
pub const SOUND_ENGINE_ERROR_SCENE_CHANGED: i32 = 6;

const MIN_SAMPLE_RATE: f32 = 8_000.0;
const MAX_SAMPLE_RATE: f32 = 384_000.0;

/// Движок целиком. Управляющая сторона и сторона аудиопотока лежат в отдельных ячейках,
/// потому что ими пользуются разные потоки одновременно.
pub struct SoundEngine {
    controller: UnsafeCell<Controller>,
    processor: UnsafeCell<Processor>,
    state: StateReader,
    last_error: UnsafeCell<CString>,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SoundEngineState {
    /// 0 — сцена не загружена, 1 — пауза, 2 — играет, 3 — затухает перед паузой.
    pub status: i32,
    /// Секунды до срабатывания таймера или -1, если таймер выключен.
    pub timer_remaining_seconds: f32,
    /// Сглаженная громкость выхода (RMS) для анимации.
    pub level: f32,
    /// Номер последней команды, которую обработал аудиопоток.
    pub applied_command: u32,
}

enum ControlError {
    InvalidArgument(&'static str),
    Engine(EngineError),
}

/// Создаёт движок. Возвращает пустой указатель, если частота дискретизации вне 8–384 кГц.
#[unsafe(no_mangle)]
pub extern "C" fn sound_engine_create(sample_rate: f32) -> *mut SoundEngine {
    if !(MIN_SAMPLE_RATE..=MAX_SAMPLE_RATE).contains(&sample_rate) {
        return std::ptr::null_mut();
    }
    let (controller, processor) = create(sample_rate);
    let state = controller.state_reader();
    Box::into_raw(Box::new(SoundEngine {
        controller: UnsafeCell::new(controller),
        processor: UnsafeCell::new(processor),
        state,
        last_error: UnsafeCell::new(CString::default()),
    }))
}

/// Уничтожает движок.
///
/// # Safety
///
/// `engine` получен из `sound_engine_create` и больше не используется ни в одном потоке,
/// в том числе аудиопоток остановлен.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_destroy(engine: *mut SoundEngine) {
    if !engine.is_null() {
        drop(unsafe { Box::from_raw(engine) });
    }
}

/// Загружает сцену из JSON. Если звук играет, новая сцена плавно сменяет старую.
///
/// # Safety
///
/// `engine` — живой движок, `scene_json` — строка в UTF-8 с нулём на конце.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_load_scene(engine: *mut SoundEngine, scene_json: *const c_char) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            let json = read_str(scene_json)?;
            controller.load_scene_json(json).map_err(ControlError::Engine)
        })
    }
}

/// Загружает сцену с сохранёнными положениями ручек.
///
/// # Safety
///
/// `engine` — живой движок, оба аргумента JSON — строки в UTF-8 с нулём на конце.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_load_scene_with_knobs(
    engine: *mut SoundEngine,
    scene_json: *const c_char,
    knobs_json: *const c_char,
) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            let scene = sound_core::Scene::from_json(read_str(scene_json)?)
                .map_err(EngineError::from)
                .map_err(ControlError::Engine)?;
            let knobs = serde_json::from_str(read_str(knobs_json)?)
                .map_err(|_| ControlError::InvalidArgument("не удалось прочитать сохранённые положения ручек"))?;
            controller.load_scene_with_knobs(&scene, &knobs).map_err(ControlError::Engine)
        })
    }
}

/// # Safety
///
/// `engine` — живой движок.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_play(engine: *mut SoundEngine) -> i32 {
    unsafe { with_controller(engine, |controller| controller.play().map_err(ControlError::Engine)) }
}

/// # Safety
///
/// `engine` — живой движок.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_pause(engine: *mut SoundEngine) -> i32 {
    unsafe { with_controller(engine, |controller| controller.pause().map_err(ControlError::Engine)) }
}

/// Ставит ручку текущей сцены в положение от 0 до 1.
///
/// # Safety
///
/// `engine` — живой движок, `knob_id` — строка в UTF-8 с нулём на конце.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_set_knob(engine: *mut SoundEngine, knob_id: *const c_char, position: f32) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            let knob_id = read_str(knob_id)?;
            controller.set_knob(knob_id, position).map_err(ControlError::Engine)
        })
    }
}

/// Ставит ручку, если команда адресована текущей сцене управления.
///
/// # Safety
///
/// `engine` — живой движок, идентификаторы — строки в UTF-8 с нулём на конце.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_set_scene_knob(
    engine: *mut SoundEngine,
    scene_id: *const c_char,
    knob_id: *const c_char,
    position: f32,
) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            if !position.is_finite() {
                return Err(ControlError::InvalidArgument("положение ручки должно быть конечным числом"));
            }
            controller.set_scene_knob(read_str(scene_id)?, read_str(knob_id)?, position).map_err(ControlError::Engine)
        })
    }
}

/// Возвращает авторские положения ручек указанной сцены.
///
/// # Safety
///
/// `engine` — живой движок, `scene_id` — строка в UTF-8 с нулём на конце.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_reset_scene_knobs(engine: *mut SoundEngine, scene_id: *const c_char) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            controller.reset_scene_knobs(read_str(scene_id)?).map_err(ControlError::Engine)
        })
    }
}

/// Включает таймер на `seconds` секунд игры. Ноль или отрицательное значение выключает таймер.
///
/// # Safety
///
/// `engine` — живой движок.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_set_timer(engine: *mut SoundEngine, seconds: f32) -> i32 {
    let seconds = (seconds.is_finite() && seconds > 0.0).then_some(seconds);
    unsafe { with_controller(engine, |controller| controller.set_timer(seconds).map_err(ControlError::Engine)) }
}

/// Добавляет время к включённому таймеру.
///
/// # Safety
///
/// `engine` — живой движок.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_extend_timer(engine: *mut SoundEngine, seconds: f32) -> i32 {
    unsafe { with_controller(engine, |controller| controller.extend_timer(seconds).map_err(ControlError::Engine)) }
}

/// Задаёт общую громкость от 0 до 1.
///
/// # Safety
///
/// `engine` — живой движок.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_set_volume(engine: *mut SoundEngine, volume: f32) -> i32 {
    unsafe {
        with_controller(engine, |controller| {
            controller.set_volume(volume);
            Ok(())
        })
    }
}

/// Возвращает текст ошибки последней функции управления. Пустая строка, если ошибки не было.
/// Указатель живёт до следующего вызова функции управления.
///
/// # Safety
///
/// `engine` — живой движок или пустой указатель.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_last_error(engine: *const SoundEngine) -> *const c_char {
    match unsafe { engine.as_ref() } {
        Some(engine) => unsafe { (*engine.last_error.get()).as_ptr() },
        None => c"движок не создан".as_ptr(),
    }
}

/// Заполняет `frames` отсчётов в каждом из двух буферов.
/// При нулевом размере обрабатывает команды без продвижения звука.
///
/// # Safety
///
/// `engine` — живой движок; `left` и `right` указывают на непересекающиеся буферы
/// длиной не меньше `frames`. При нулевом размере указатели могут быть пустыми.
/// У движка может быть только один поток рендера в каждый момент времени.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_render(engine: *mut SoundEngine, left: *mut f32, right: *mut f32, frames: u32) {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return;
    };
    if frames == 0 {
        unsafe { &mut *engine.processor.get() }.render(&mut [], &mut []);
        return;
    }
    if left.is_null() || right.is_null() {
        return;
    }
    let processor = unsafe { &mut *engine.processor.get() };
    let (left, right) = unsafe {
        (slice::from_raw_parts_mut(left, frames as usize), slice::from_raw_parts_mut(right, frames as usize))
    };
    processor.render(left, right);
}

/// Возвращает состояние плеера. Можно вызывать из любого потока.
///
/// # Safety
///
/// `engine` — живой движок или пустой указатель.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_get_state(engine: *const SoundEngine) -> SoundEngineState {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return SoundEngineState { status: 0, timer_remaining_seconds: -1.0, level: 0.0, applied_command: 0 };
    };
    let state = engine.state.state();
    SoundEngineState {
        status: i32::from(state.status as u8),
        timer_remaining_seconds: state.timer_remaining_seconds.unwrap_or(-1.0),
        level: state.level,
        applied_command: state.applied_command,
    }
}

/// Возвращает номер последней команды, поставленной в очередь аудиопотока.
///
/// # Safety
///
/// `engine` — живой движок или пустой указатель. Вызов относится к управляющей стороне.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_queued_command(engine: *const SoundEngine) -> u32 {
    match unsafe { engine.as_ref() } {
        Some(engine) => unsafe { (*engine.controller.get()).queued_command() },
        None => 0,
    }
}

/// Возвращает снимок плеера в JSON. Строку освобождает `sound_engine_free_snapshot`.
///
/// # Safety
///
/// `engine` — живой движок или пустой указатель. Вызов относится к управляющей стороне.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_copy_snapshot(engine: *mut SoundEngine) -> *mut c_char {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return std::ptr::null_mut();
    };
    let (state, scene) = unsafe { (&mut *engine.controller.get()).snapshot() };
    let snapshot = serde_json::json!({
        "status": state.status as u8,
        "remainingSeconds": state.timer_remaining_seconds,
        "timerExpired": state.timer_expired,
        "rms": state.level,
        "bells": state.bells.iter().filter(|note| note.level > 0.0).collect::<Vec<_>>(),
        "appliedCommand": state.applied_command,
        "scene": scene,
    });
    CString::new(snapshot.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// # Safety
///
/// `snapshot` — строка из `sound_engine_copy_snapshot`, которая ещё не освобождена,
/// или пустой указатель.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn sound_engine_free_snapshot(snapshot: *mut c_char) {
    if !snapshot.is_null() {
        drop(unsafe { CString::from_raw(snapshot) });
    }
}

/// Выполняет действие управляющей стороны и запоминает текст ошибки для `sound_engine_last_error`.
unsafe fn with_controller(
    engine: *mut SoundEngine,
    action: impl FnOnce(&mut Controller) -> Result<(), ControlError>,
) -> i32 {
    let Some(engine) = (unsafe { engine.as_ref() }) else {
        return SOUND_ENGINE_ERROR_INVALID_ARGUMENT;
    };
    let controller = unsafe { &mut *engine.controller.get() };
    let (code, message) = match action(controller) {
        Ok(()) => (SOUND_ENGINE_OK, String::new()),
        Err(ControlError::InvalidArgument(message)) => (SOUND_ENGINE_ERROR_INVALID_ARGUMENT, message.to_owned()),
        Err(ControlError::Engine(error)) => (error_code(&error), error.to_string()),
    };
    let message = CString::new(message.replace('\0', " ")).unwrap_or_default();
    unsafe { *engine.last_error.get() = message };
    code
}

fn error_code(error: &EngineError) -> i32 {
    match error {
        EngineError::Scene(_) => SOUND_ENGINE_ERROR_SCENE,
        EngineError::UnknownKnob(_) => SOUND_ENGINE_ERROR_UNKNOWN_KNOB,
        EngineError::SceneChanged => SOUND_ENGINE_ERROR_SCENE_CHANGED,
        EngineError::QueueFull => SOUND_ENGINE_ERROR_QUEUE_FULL,
        EngineError::ProcessorGone => SOUND_ENGINE_ERROR_PROCESSOR_GONE,
    }
}

/// Читает строку из C. Время жизни результата задаёт вызывающий: строка не должна освобождаться,
/// пока результат используется.
unsafe fn read_str<'a>(pointer: *const c_char) -> Result<&'a str, ControlError> {
    if pointer.is_null() {
        return Err(ControlError::InvalidArgument("передан пустой указатель на строку"));
    }
    unsafe { CStr::from_ptr(pointer) }.to_str().map_err(|_| ControlError::InvalidArgument("строка не в UTF-8"))
}

#[cfg(test)]
mod tests {
    use std::ffi::CString;

    use super::*;

    const SCENE_JSON: &str = r#"{
        "id": "ffi",
        "name": "Проверка C-интерфейса",
        "harmony": { "root": 60, "scale": [0, 2, 4, 7, 9], "chords": [[0, 7, 12]], "chordSeconds": [10, 12] },
        "layers": [{ "type": "pad", "id": "pad" }],
        "knobs": [{ "id": "brightness", "name": "Яркость", "targets": [{ "param": "pad.cutoff", "from": 500, "to": 3000 }] }]
    }"#;

    fn last_error(engine: *const SoundEngine) -> String {
        unsafe { CStr::from_ptr(sound_engine_last_error(engine)) }.to_string_lossy().into_owned()
    }

    #[test]
    fn creates_plays_and_reports_state() {
        let engine = sound_engine_create(48_000.0);
        assert!(!engine.is_null());
        let scene = CString::new(SCENE_JSON).unwrap();
        let knob = CString::new("brightness").unwrap();
        let mut left = vec![0.0f32; 4800];
        let mut right = vec![0.0f32; 4800];
        unsafe {
            assert_eq!(sound_engine_load_scene(engine, scene.as_ptr()), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_set_knob(engine, knob.as_ptr(), 0.8), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_set_timer(engine, 600.0), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_play(engine), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_queued_command(engine), 4);
            assert_eq!(sound_engine_get_state(engine).applied_command, 0);
            sound_engine_render(engine, std::ptr::null_mut(), std::ptr::null_mut(), 0);
            let state = sound_engine_get_state(engine);
            assert_eq!(state.applied_command, 4);
            assert_eq!(state.timer_remaining_seconds, 600.0);
            for _ in 0..20 {
                sound_engine_render(engine, left.as_mut_ptr(), right.as_mut_ptr(), 4800);
            }
            let state = sound_engine_get_state(engine);
            assert_eq!(state.status, 2);
            assert!(state.level > 0.0);
            assert!(state.timer_remaining_seconds > 590.0 && state.timer_remaining_seconds < 600.0);
            assert_eq!(state.applied_command, 4);
            let snapshot = sound_engine_copy_snapshot(engine);
            let json: serde_json::Value = serde_json::from_slice(CStr::from_ptr(snapshot).to_bytes()).unwrap();
            sound_engine_free_snapshot(snapshot);
            assert_eq!(json["scene"]["sceneId"], "ffi");
            assert_eq!(json["scene"]["knobLabels"][0]["name"], "Яркость");
            assert!((json["scene"]["knobs"]["brightness"].as_f64().unwrap() - 0.8).abs() < 0.000_001);
            sound_engine_destroy(engine);
        }
        assert!(left.iter().any(|sample| *sample != 0.0));
    }

    #[test]
    fn restores_and_resets_knobs_without_changing_transport() {
        let engine = sound_engine_create(48_000.0);
        let scene = CString::new(SCENE_JSON).unwrap();
        unsafe {
            assert_eq!(
                sound_engine_load_scene_with_knobs(engine, scene.as_ptr(), c"{\"brightness\":1.0}".as_ptr()),
                SOUND_ENGINE_OK
            );
            sound_engine_render(engine, std::ptr::null_mut(), std::ptr::null_mut(), 0);
            let (state, scene) = (&mut *(*engine).controller.get()).snapshot();
            assert_eq!(state.status, sound_core::PlaybackStatus::Paused);
            assert_eq!(scene.unwrap().knobs["brightness"], 1.0);

            assert_eq!(sound_engine_reset_scene_knobs(engine, c"other".as_ptr()), SOUND_ENGINE_ERROR_SCENE_CHANGED);
            assert_eq!(sound_engine_set_timer(engine, 2400.0), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_play(engine), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_reset_scene_knobs(engine, c"ffi".as_ptr()), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_extend_timer(engine, 600.0), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_extend_timer(engine, 600.0), SOUND_ENGINE_OK);
            sound_engine_render(engine, std::ptr::null_mut(), std::ptr::null_mut(), 0);
            let (state, scene) = (&mut *(*engine).controller.get()).snapshot();
            assert_eq!(state.status, sound_core::PlaybackStatus::Playing);
            assert_eq!(state.timer_remaining_seconds, Some(3600.0));
            assert_eq!(scene.unwrap().knobs["brightness"], 0.5);

            assert_eq!(sound_engine_set_timer(engine, 0.0), SOUND_ENGINE_OK);
            assert_eq!(sound_engine_extend_timer(engine, 600.0), SOUND_ENGINE_OK);
            sound_engine_render(engine, std::ptr::null_mut(), std::ptr::null_mut(), 0);
            assert_eq!(sound_engine_get_state(engine).timer_remaining_seconds, -1.0);
            sound_engine_destroy(engine);
        }
    }

    #[test]
    fn reports_errors_with_text() {
        let engine = sound_engine_create(48_000.0);
        let broken_scene = CString::new("{ \"id\": 1 }").unwrap();
        let unknown_knob = CString::new("loudness").unwrap();
        unsafe {
            assert_eq!(sound_engine_load_scene(engine, broken_scene.as_ptr()), SOUND_ENGINE_ERROR_SCENE);
            assert!(last_error(engine).starts_with("сцена не читается"));
            assert_eq!(sound_engine_set_knob(engine, unknown_knob.as_ptr(), 0.5), SOUND_ENGINE_ERROR_UNKNOWN_KNOB);
            assert_eq!(sound_engine_load_scene(engine, std::ptr::null()), SOUND_ENGINE_ERROR_INVALID_ARGUMENT);
            assert_eq!(sound_engine_play(engine), SOUND_ENGINE_OK);
            assert!(last_error(engine).is_empty());
            sound_engine_destroy(engine);
        }
    }

    #[test]
    fn rejects_knob_for_previous_scene_before_rendering_the_switch() {
        let engine = sound_engine_create(48_000.0);
        let scene = CString::new(SCENE_JSON).unwrap();
        let next_scene = CString::new(SCENE_JSON.replace("\"ffi\"", "\"next\"")).unwrap();
        let mut left = [0.0];
        let mut right = [0.0];
        unsafe {
            assert_eq!(sound_engine_load_scene(engine, scene.as_ptr()), SOUND_ENGINE_OK);
            sound_engine_render(engine, left.as_mut_ptr(), right.as_mut_ptr(), 1);
            assert_eq!(sound_engine_load_scene(engine, next_scene.as_ptr()), SOUND_ENGINE_OK);
            assert_eq!(
                sound_engine_set_scene_knob(engine, c"ffi".as_ptr(), c"brightness".as_ptr(), 0.8),
                SOUND_ENGINE_ERROR_SCENE_CHANGED
            );
            assert_eq!(sound_engine_queued_command(engine), 2);
            assert_eq!(sound_engine_get_state(engine).applied_command, 1);
            assert_eq!(
                sound_engine_set_scene_knob(engine, c"next".as_ptr(), c"brightness".as_ptr(), f32::NAN),
                SOUND_ENGINE_ERROR_INVALID_ARGUMENT
            );
            assert_eq!(sound_engine_queued_command(engine), 2);
            sound_engine_destroy(engine);
        }
    }

    #[test]
    fn rejects_bad_sample_rate_and_null_engine() {
        assert!(sound_engine_create(0.0).is_null());
        assert!(sound_engine_create(f32::NAN).is_null());
        unsafe {
            assert_eq!(sound_engine_play(std::ptr::null_mut()), SOUND_ENGINE_ERROR_INVALID_ARGUMENT);
            assert_eq!(sound_engine_get_state(std::ptr::null()).status, 0);
            sound_engine_render(std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), 128);
            sound_engine_destroy(std::ptr::null_mut());
        }
    }
}
