mod common;

use std::path::PathBuf;

use common::{SAMPLE_RATE, TEST_SCENE};
use sound_core::{EngineError, Scene, SceneError, create};

fn load(json: &str) -> Result<(), EngineError> {
    let (mut controller, _processor) = create(SAMPLE_RATE);
    controller.load_scene_json(json)
}

fn assert_invalid(json: &str, expected_fragment: &str) {
    match load(json) {
        Err(EngineError::Scene(SceneError::Invalid(message) | SceneError::Format(message))) => {
            assert!(message.contains(expected_fragment), "ожидали «{expected_fragment}» в «{message}»");
        }
        other => panic!("ожидали ошибку сцены с «{expected_fragment}», получили {other:?}"),
    }
}

/// Подменяет в тестовой сцене фрагмент JSON, чтобы получить сцену с одной ошибкой.
fn broken_scene(from: &str, to: &str) -> String {
    assert!(TEST_SCENE.contains(from), "в тестовой сцене нет фрагмента «{from}»");
    TEST_SCENE.replacen(from, to, 1)
}

#[test]
fn bundled_scenes_load() {
    let scenes_directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../scenes");
    let mut scene_count = 0;
    for entry in std::fs::read_dir(&scenes_directory).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|extension| extension != "json") {
            continue;
        }
        let json = std::fs::read_to_string(&path).unwrap();
        load(&json).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let scene = Scene::from_json(&json).unwrap();
        assert_eq!(path.file_stem().unwrap(), scene.id.as_str(), "имя файла должно совпадать с id сцены");
        scene_count += 1;
    }
    assert!(scene_count >= 3);
}

#[test]
fn test_scene_loads() {
    load(TEST_SCENE).unwrap();
}

#[test]
fn rejects_unknown_field() {
    assert_invalid(&broken_scene(r#""seed": 7"#, r#""seed": 7, "tempo": 3"#), "tempo");
}

#[test]
fn rejects_unknown_layer_field() {
    assert_invalid(&broken_scene(r#""id": "noise","#, r#""id": "noise", "color": "brown","#), "color");
}

#[test]
fn rejects_unknown_layer_type() {
    assert_invalid(&broken_scene(r#""type": "noise""#, r#""type": "rain""#), "rain");
}

#[test]
fn rejects_unknown_param() {
    assert_invalid(&broken_scene(r#""waveDepth": 0.03"#, r#""waveDeep": 0.03"#), "waveDeep");
}

#[test]
fn rejects_param_out_of_range() {
    assert_invalid(&broken_scene(r#""waveDepth": 0.03"#, r#""waveDepth": 3"#), "вне диапазона");
}

#[test]
fn rejects_duplicate_layer_id() {
    assert_invalid(&broken_scene(r#""id": "noise""#, r#""id": "pad""#), "повторяется");
}

#[test]
fn rejects_reserved_layer_id() {
    assert_invalid(&broken_scene(r#""id": "noise""#, r#""id": "scene""#), "недопустим");
}

#[test]
fn rejects_knob_target_on_missing_layer() {
    assert_invalid(&broken_scene(r#""param": "pad.cutoff""#, r#""param": "lead.cutoff""#), "lead");
}

#[test]
fn rejects_knob_target_on_missing_param() {
    assert_invalid(&broken_scene(r#""param": "pad.cutoff""#, r#""param": "pad.color""#), "color");
}

#[test]
fn rejects_param_set_both_in_layer_and_by_knob() {
    assert_invalid(
        &broken_scene(r#""params": { "attack": 0.5"#, r#""params": { "cutoff": 900, "attack": 0.5"#),
        "задаёт ручка",
    );
}

#[test]
fn rejects_exponential_curve_through_zero() {
    assert_invalid(
        &broken_scene(
            r#""param": "scene.reverbLevel", "from": 0.1"#,
            r#""param": "scene.reverbLevel", "curve": "exponential", "from": 0"#,
        ),
        "положительные",
    );
}

#[test]
fn rejects_empty_chords() {
    assert_invalid(&broken_scene(r#""chords": [[0, 7, 12, 16], [-3, 4, 9, 12]]"#, r#""chords": []"#), "chords");
}

#[test]
fn rejects_inverted_chord_duration() {
    assert_invalid(&broken_scene(r#""chordSeconds": [2, 3]"#, r#""chordSeconds": [3, 2]"#), "chordSeconds");
}
