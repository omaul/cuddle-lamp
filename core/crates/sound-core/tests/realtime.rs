//! Проверяет главное правило аудиопотока: `Processor::render` не выделяет и не освобождает память.
//! Выделение в аудиопотоке может ждать системный аллокатор, и тогда звук прерывается.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::{OTHER_SCENE, SAMPLE_RATE, TEST_SCENE, seconds_to_frames};
use sound_core::{Processor, create};

/// Аллокатор, который считает выделения в потоке, пока включён подсчёт.
struct CountingAllocator;

thread_local! {
    static IS_COUNTING: Cell<bool> = const { Cell::new(false) };
    static ALLOCATION_COUNT: Cell<usize> = const { Cell::new(0) };
}

fn record_allocation() {
    let _ = IS_COUNTING.try_with(|is_counting| {
        if is_counting.get() {
            ALLOCATION_COUNT.with(|count| count.set(count.get() + 1));
        }
    });
}

unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record_allocation();
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        record_allocation();
        unsafe { System.dealloc(pointer, layout) }
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        record_allocation();
        unsafe { System.realloc(pointer, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

/// Рендерит `seconds` секунд и возвращает, сколько раз за это время выделялась или освобождалась память.
fn count_allocations_while_rendering(processor: &mut Processor, seconds: f32) -> usize {
    let mut left = vec![0.0; 256];
    let mut right = vec![0.0; 256];
    let block_count = seconds_to_frames(seconds) / left.len();
    ALLOCATION_COUNT.with(|count| count.set(0));
    IS_COUNTING.with(|is_counting| is_counting.set(true));
    for _ in 0..block_count {
        processor.render(&mut left, &mut right);
    }
    IS_COUNTING.with(|is_counting| is_counting.set(false));
    ALLOCATION_COUNT.with(Cell::get)
}

#[test]
fn counter_notices_allocations() {
    ALLOCATION_COUNT.with(|count| count.set(0));
    IS_COUNTING.with(|is_counting| is_counting.set(true));
    let buffer = std::hint::black_box(vec![0u8; 64]);
    drop(buffer);
    IS_COUNTING.with(|is_counting| is_counting.set(false));
    assert_eq!(ALLOCATION_COUNT.with(Cell::get), 2);
}

#[test]
fn render_does_not_allocate() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(TEST_SCENE).unwrap();
    controller.set_knob("brightness", 0.8).unwrap();
    controller.set_timer(Some(6.0)).unwrap();
    controller.play().unwrap();
    assert_eq!(count_allocations_while_rendering(&mut processor, 4.0), 0, "загрузка и игра сцены");

    controller.load_scene_json(OTHER_SCENE).unwrap();
    assert_eq!(count_allocations_while_rendering(&mut processor, 6.0), 0, "смена сцены и таймер");

    controller.load_scene_json(TEST_SCENE).unwrap();
    controller.set_knob("space", 0.2).unwrap();
    controller.pause().unwrap();
    assert_eq!(count_allocations_while_rendering(&mut processor, 3.0), 0, "пауза");
}

#[test]
fn render_does_not_free_queued_scenes_when_controller_stops_reading() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    for _ in 0..24 {
        controller.load_scene_json(TEST_SCENE).unwrap();
    }
    drop(controller);
    assert_eq!(count_allocations_while_rendering(&mut processor, 0.1), 0);
}

#[test]
fn render_returns_scenes_after_the_controller_drains_the_return_queue() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(TEST_SCENE).unwrap();
    controller.play().unwrap();
    assert_eq!(count_allocations_while_rendering(&mut processor, 0.1), 0);

    for _ in 0..24 {
        controller.load_scene_json(OTHER_SCENE).unwrap();
    }
    assert_eq!(count_allocations_while_rendering(&mut processor, 0.1), 0);

    let (state, _) = controller.snapshot();
    assert_eq!(state.applied_command, 26);
    assert_eq!(count_allocations_while_rendering(&mut processor, 0.1), 0);
    controller.snapshot();
    controller.load_scene_json(TEST_SCENE).unwrap();
    assert_eq!(count_allocations_while_rendering(&mut processor, 0.1), 0);
    assert_eq!(controller.state().applied_command, 27);
}
