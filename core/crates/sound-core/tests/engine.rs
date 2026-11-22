mod common;

use common::{OTHER_SCENE, SAMPLE_RATE, TEST_SCENE, peak, render, rms, seconds_to_frames};
use sound_core::{
    Controller, EngineError, PAUSE_FADE_SECONDS, PlaybackStatus, Processor, Scene, TIMER_FADE_SECONDS, create,
};

fn create_playing(scene_json: &str) -> (Controller, Processor) {
    let (mut controller, processor) = create(SAMPLE_RATE);
    controller.load_scene_json(scene_json).unwrap();
    controller.play().unwrap();
    (controller, processor)
}

fn scene_with_seed(seed: u64) -> Scene {
    let mut scene = Scene::from_json(TEST_SCENE).unwrap();
    scene.seed = seed;
    scene
}

#[test]
fn same_seed_gives_same_sound() {
    let (_first_controller, mut first) = create_playing(TEST_SCENE);
    let (_second_controller, mut second) = create_playing(TEST_SCENE);
    let first_output = render(&mut first, seconds_to_frames(5.0), 512);
    let second_output = render(&mut second, seconds_to_frames(5.0), 512);
    assert_eq!(first_output, second_output);
}

#[test]
fn different_seed_gives_different_sound() {
    let (mut first_controller, mut first) = create(SAMPLE_RATE);
    let (mut second_controller, mut second) = create(SAMPLE_RATE);
    first_controller.load_scene(&scene_with_seed(1)).unwrap();
    second_controller.load_scene(&scene_with_seed(2)).unwrap();
    first_controller.play().unwrap();
    second_controller.play().unwrap();
    let first_output = render(&mut first, seconds_to_frames(3.0), 512);
    let second_output = render(&mut second, seconds_to_frames(3.0), 512);
    assert_ne!(first_output, second_output);
}

#[test]
fn block_size_does_not_change_sound() {
    let (_small_controller, mut small_blocks) = create_playing(TEST_SCENE);
    let (_large_controller, mut large_blocks) = create_playing(TEST_SCENE);
    let small_output = render(&mut small_blocks, seconds_to_frames(4.0), 64);
    let large_output = render(&mut large_blocks, seconds_to_frames(4.0), 1013);
    assert_eq!(small_output, large_output);
}

#[test]
fn output_is_finite_audible_and_within_range() {
    let (_controller, mut processor) = create_playing(TEST_SCENE);
    let (left, right) = render(&mut processor, seconds_to_frames(30.0), 512);
    assert!(left.iter().chain(&right).all(|sample| sample.is_finite()));
    assert!(peak(&left).max(peak(&right)) <= 1.0);
    let tail = seconds_to_frames(10.0)..;
    assert!(rms(&left[tail.clone()]) > 0.005, "звук слишком тихий: {}", rms(&left[tail]));
}

#[test]
fn stays_idle_without_scene() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.play().unwrap();
    let (left, _) = render(&mut processor, 4800, 512);
    assert!(left.iter().all(|sample| *sample == 0.0));
    assert_eq!(controller.state().status, PlaybackStatus::Idle);
}

#[test]
fn loaded_scene_is_silent_until_play() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(TEST_SCENE).unwrap();
    let (left, _) = render(&mut processor, 4800, 512);
    assert!(left.iter().all(|sample| *sample == 0.0));
    assert_eq!(controller.state().status, PlaybackStatus::Paused);
}

#[test]
fn pause_fades_out_and_resume_fades_in() {
    let (mut controller, mut processor) = create_playing(TEST_SCENE);
    render(&mut processor, seconds_to_frames(5.0), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Playing);

    controller.pause().unwrap();
    let (fading, _) = render(&mut processor, seconds_to_frames(0.5), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Stopping);
    assert!(fading.iter().any(|sample| *sample != 0.0));

    render(&mut processor, seconds_to_frames(PAUSE_FADE_SECONDS), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Paused);
    let (silent, _) = render(&mut processor, 4800, 512);
    assert!(silent.iter().all(|sample| *sample == 0.0));

    controller.play().unwrap();
    let (resumed, _) = render(&mut processor, seconds_to_frames(3.0), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Playing);
    assert!(rms(&resumed[seconds_to_frames(2.0)..]) > 0.005);
}

#[test]
fn timer_fades_out_and_pauses() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(TEST_SCENE).unwrap();
    controller.set_timer(Some(2.0)).unwrap();
    controller.play().unwrap();

    render(&mut processor, seconds_to_frames(1.0), 512);
    let remaining = controller.state().timer_remaining_seconds.unwrap();
    assert!(remaining > 0.9 && remaining < 1.1, "осталось {remaining} с");

    render(&mut processor, seconds_to_frames(1.5), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Stopping);
    assert_eq!(controller.state().timer_remaining_seconds, None);

    render(&mut processor, seconds_to_frames(TIMER_FADE_SECONDS), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Paused);
}

#[test]
fn disabled_timer_does_not_stop_playback() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(TEST_SCENE).unwrap();
    controller.set_timer(Some(1.0)).unwrap();
    controller.set_timer(None).unwrap();
    controller.play().unwrap();
    render(&mut processor, seconds_to_frames(3.0), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Playing);
}

#[test]
fn knob_changes_sound() {
    let (mut dark_controller, mut dark) = create_playing(TEST_SCENE);
    let (mut bright_controller, mut bright) = create_playing(TEST_SCENE);
    dark_controller.set_knob("brightness", 0.0).unwrap();
    bright_controller.set_knob("brightness", 1.0).unwrap();
    let dark_output = render(&mut dark, seconds_to_frames(3.0), 512);
    let bright_output = render(&mut bright, seconds_to_frames(3.0), 512);
    assert_ne!(dark_output, bright_output);
}

#[test]
fn unknown_knob_is_rejected() {
    let (mut controller, _processor) = create_playing(TEST_SCENE);
    assert_eq!(controller.set_knob("loudness", 0.5), Err(EngineError::UnknownKnob("loudness".to_owned())));
}

#[test]
fn knobs_follow_the_latest_scene() {
    let (mut controller, _processor) = create_playing(TEST_SCENE);
    controller.load_scene_json(OTHER_SCENE).unwrap();
    assert!(matches!(controller.set_knob("brightness", 0.5), Err(EngineError::UnknownKnob(_))));
}

#[test]
fn scene_switch_keeps_playing_without_gaps() {
    let (mut controller, mut processor) = create_playing(TEST_SCENE);
    render(&mut processor, seconds_to_frames(4.0), 512);
    controller.load_scene_json(OTHER_SCENE).unwrap();
    let (left, right) = render(&mut processor, seconds_to_frames(6.0), 512);
    assert_eq!(controller.state().status, PlaybackStatus::Playing);
    assert!(left.iter().chain(&right).all(|sample| sample.is_finite()));
    // Во время смены звук не проваливается в тишину
    for window in left.chunks(seconds_to_frames(0.25)) {
        assert!(rms(window) > 0.002, "провал громкости при смене сцены: {}", rms(window));
    }
}

#[test]
fn reports_level_while_playing() {
    let (controller, mut processor) = create_playing(TEST_SCENE);
    render(&mut processor, seconds_to_frames(3.0), 512);
    assert!(controller.state().level > 0.0);
}

#[test]
fn volume_scales_output() {
    let (_loud_controller, mut loud) = create_playing(TEST_SCENE);
    let (quiet_controller, mut quiet) = create_playing(TEST_SCENE);
    quiet_controller.set_volume(0.5);
    let (loud_left, _) = render(&mut loud, seconds_to_frames(3.0), 512);
    let (quiet_left, _) = render(&mut quiet, seconds_to_frames(3.0), 512);
    let ratio = rms(&quiet_left[seconds_to_frames(1.0)..]) / rms(&loud_left[seconds_to_frames(1.0)..]);
    assert!((ratio - 0.5).abs() < 0.05, "отношение громкостей {ratio}");
}
