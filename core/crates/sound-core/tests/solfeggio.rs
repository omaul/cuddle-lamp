mod common;

use std::collections::BTreeMap;

use common::{SAMPLE_RATE, peak, render, seconds_to_frames};
use sound_core::{PlaybackStatus, Scene, create};

const SOLFEGGIO: &str = include_str!("../../../../scenes/solfeggio.json");
const FREQUENCIES: [u32; 9] = [174, 285, 396, 417, 528, 639, 741, 852, 963];

fn measure_frequency(samples: &[f32]) -> f32 {
    let crossings = samples
        .windows(2)
        .enumerate()
        .filter(|(_, pair)| pair[0] <= 0.0 && pair[1] > 0.0)
        .map(|(index, pair)| f64::from(-pair[0] / (pair[1] - pair[0])) + index as f64)
        .collect::<Vec<_>>();
    let span = crossings.last().unwrap() - crossings.first().unwrap();
    ((crossings.len() - 1) as f64 * f64::from(SAMPLE_RATE) / span) as f32
}

#[test]
fn each_saved_preset_is_confirmed_and_produces_its_exact_tone() {
    let scene = Scene::from_json(SOLFEGGIO).unwrap();
    for (index, frequency) in FREQUENCIES.into_iter().enumerate() {
        let position = index as f32 / 8.0;
        let saved = BTreeMap::from([("frequency".to_owned(), position)]);
        let (mut controller, mut processor) = create(SAMPLE_RATE);
        controller.load_scene_with_knobs(&scene, &saved).unwrap();
        assert!(controller.snapshot().1.is_none());
        let (silence, _) = render(&mut processor, 16, 16);
        let (state, confirmed) = controller.snapshot();
        let confirmed = confirmed.unwrap();
        assert_eq!(state.status, PlaybackStatus::Paused);
        assert_eq!(peak(&silence), 0.0);
        assert_eq!(confirmed.knobs["frequency"], position);
        assert_eq!(confirmed.knob_labels[0].choices.as_ref().unwrap().values[index], frequency as f32);

        controller.play().unwrap();
        let (left, right) = render(&mut processor, seconds_to_frames(0.5), 257);
        assert_eq!(left, right);
        assert!((measure_frequency(&left) - frequency as f32).abs() < 1.0);
    }
}

#[test]
fn changing_a_paused_preset_applies_it_before_the_first_sound() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(SOLFEGGIO).unwrap();
    render(&mut processor, 16, 16);
    assert_eq!(controller.snapshot().1.unwrap().knobs["frequency"], 0.5);

    controller.set_scene_knob("solfeggio", "frequency", 0.98).unwrap();
    assert_eq!(controller.snapshot().1.unwrap().knobs["frequency"], 0.5);
    let (silence, _) = render(&mut processor, 16, 16);
    assert_eq!(peak(&silence), 0.0);
    assert_eq!(controller.snapshot().1.unwrap().knobs["frequency"], 1.0);

    controller.play().unwrap();
    let (left, _) = render(&mut processor, seconds_to_frames(0.04), 257);
    assert!((measure_frequency(&left) - 963.0).abs() < 1.0);

    controller.reset_scene_knobs("solfeggio").unwrap();
    let (left, _) = render(&mut processor, seconds_to_frames(0.5), 257);
    assert_eq!(controller.snapshot().1.unwrap().knobs["frequency"], 0.5);
    assert!((measure_frequency(&left[seconds_to_frames(0.3)..]) - 528.0).abs() < 1.0);
}

#[test]
fn retuning_preserves_oscillator_phase() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    let (mut reference, mut reference_processor) = create(SAMPLE_RATE);
    for player in [&mut controller, &mut reference] {
        player.load_scene_json(SOLFEGGIO).unwrap();
        player.set_knob("frequency", 0.0).unwrap();
        player.play().unwrap();
    }
    let frames = seconds_to_frames(3.0) + 67;
    render(&mut processor, frames, 257);
    render(&mut reference_processor, frames, 257);

    controller.set_knob("frequency", 1.0).unwrap();
    let (reference, _) = render(&mut reference_processor, 1, 1);
    let (swept, _) = render(&mut processor, seconds_to_frames(0.5), 257);
    assert_eq!(swept[0], reference[0]);
    let max_step = swept.windows(2).map(|pair| (pair[1] - pair[0]).abs()).fold(0.0, f32::max);
    assert!(max_step < 0.15 * peak(&swept));
    assert!((measure_frequency(&swept[seconds_to_frames(0.3)..]) - 963.0).abs() < 1.0);
}

#[test]
fn a_preset_chosen_as_pause_fade_ends_is_ready_when_playback_resumes() {
    let (mut controller, mut processor) = create(SAMPLE_RATE);
    controller.load_scene_json(SOLFEGGIO).unwrap();
    controller.play().unwrap();
    render(&mut processor, seconds_to_frames(3.0), 256);

    controller.pause().unwrap();
    render(&mut processor, seconds_to_frames(1.49), 256);
    assert_eq!(controller.snapshot().0.status, PlaybackStatus::Stopping);

    controller.set_scene_knob("solfeggio", "frequency", 1.0).unwrap();
    render(&mut processor, seconds_to_frames(0.03), 256);
    assert_eq!(controller.snapshot().0.status, PlaybackStatus::Paused);

    controller.play().unwrap();
    let (left, _) = render(&mut processor, seconds_to_frames(0.04), 256);
    assert!((measure_frequency(&left) - 963.0).abs() < 1.0);
}
