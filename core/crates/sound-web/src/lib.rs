use std::cell::RefCell;

use sound_core::{Controller, EngineError, Processor, create};

const BLOCK: usize = 128;

struct Studio {
    controller: Controller,
    processor: Processor,
    input: Vec<u8>,
    error: String,
    audio: [[f32; BLOCK]; 2],
}

thread_local! {
    static STUDIO: RefCell<Option<Studio>> = const { RefCell::new(None) };
}

fn studio<T>(run: impl FnOnce(&mut Studio) -> T) -> T {
    STUDIO.with_borrow_mut(|state| run(state.as_mut().expect("Студия не инициализирована")))
}

fn command(run: impl FnOnce(&mut Controller, &str) -> Result<(), EngineError>) -> bool {
    studio(|state| {
        state.error = match std::str::from_utf8(&state.input) {
            Ok(input) => match run(&mut state.controller, input) {
                Ok(()) => String::new(),
                Err(error) => error.to_string(),
            },
            Err(error) => error.to_string(),
        };
        state.error.is_empty()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn init(sample_rate: f32) {
    let (controller, processor) = create(sample_rate);
    STUDIO.with_borrow_mut(|state| {
        *state =
            Some(Studio { controller, processor, input: Vec::new(), error: String::new(), audio: [[0.0; BLOCK]; 2] });
    });
}

#[unsafe(no_mangle)]
pub extern "C" fn input_ptr(len: usize) -> *mut u8 {
    studio(|state| {
        state.input.resize(len, 0);
        state.input.as_mut_ptr()
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn error_ptr() -> *const u8 {
    studio(|state| state.error.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn error_len() -> usize {
    studio(|state| state.error.len())
}

#[unsafe(no_mangle)]
pub extern "C" fn load() -> bool {
    command(Controller::load_scene_json)
}

#[unsafe(no_mangle)]
pub extern "C" fn knob(position: f32) -> bool {
    command(|controller, id| controller.set_knob(id, position))
}

#[unsafe(no_mangle)]
pub extern "C" fn playback(playing: bool) -> bool {
    command(|controller, _| if playing { controller.play() } else { controller.pause() })
}

#[unsafe(no_mangle)]
pub extern "C" fn volume(value: f32) {
    studio(|state| state.controller.set_volume(value));
}

#[unsafe(no_mangle)]
pub extern "C" fn block_size() -> usize {
    BLOCK
}

#[unsafe(no_mangle)]
pub extern "C" fn audio_ptr() -> *const f32 {
    studio(|state| state.audio.as_ptr().cast())
}

#[unsafe(no_mangle)]
pub extern "C" fn render(frames: usize) {
    studio(|state| {
        let [left, right] = &mut state.audio;
        state.processor.render(&mut left[..frames], &mut right[..frames]);
    });
}
