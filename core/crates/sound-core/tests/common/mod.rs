#![allow(dead_code)]

use sound_core::Processor;

pub const SAMPLE_RATE: f32 = 48_000.0;

/// Сцена для тестов движка. Своя, а не из `scenes/`, чтобы правки контента не ломали тесты.
pub const TEST_SCENE: &str = r#"{
    "id": "test",
    "name": "Тестовая сцена",
    "seed": 7,
    "harmony": {
        "root": 60,
        "scale": [0, 2, 4, 7, 9],
        "chords": [[0, 7, 12, 16], [-3, 4, 9, 12]],
        "chordSeconds": [2, 3]
    },
    "layers": [
        { "type": "pad", "id": "pad", "params": { "attack": 0.5, "release": 1 } },
        { "type": "noise", "id": "noise", "params": { "waveDepth": 0.03 } },
        { "type": "bells", "id": "bells", "octaves": [12, 24], "params": { "gapMin": 0.3, "gapMax": 0.8 } }
    ],
    "knobs": [
        {
            "id": "brightness",
            "name": "Яркость",
            "targets": [{ "param": "pad.cutoff", "from": 300, "to": 4000, "curve": "exponential" }]
        },
        {
            "id": "space",
            "name": "Пространство",
            "targets": [{ "param": "scene.reverbLevel", "from": 0.1, "to": 1.2 }]
        }
    ]
}"#;

/// Вторая сцена для проверки смены сцен.
pub const OTHER_SCENE: &str = r#"{
    "id": "other",
    "name": "Другая сцена",
    "seed": 11,
    "harmony": { "root": 57, "scale": [0, 3, 5, 7, 10], "chords": [[0, 7, 12]], "chordSeconds": [4, 5] },
    "params": { "reverbDecay": 8, "reverbLevel": 1.0 },
    "layers": [{ "type": "pad", "id": "drone", "params": { "attack": 1 } }]
}"#;

pub fn seconds_to_frames(seconds: f32) -> usize {
    (seconds * SAMPLE_RATE) as usize
}

/// Рендерит `frame_count` отсчётов блоками по `block_frames` и возвращает оба канала.
pub fn render(processor: &mut Processor, frame_count: usize, block_frames: usize) -> (Vec<f32>, Vec<f32>) {
    let mut left = vec![0.0; frame_count];
    let mut right = vec![0.0; frame_count];
    let mut start = 0;
    while start < frame_count {
        let end = (start + block_frames).min(frame_count);
        processor.render(&mut left[start..end], &mut right[start..end]);
        start = end;
    }
    (left, right)
}

pub fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    (samples.iter().map(|sample| sample * sample).sum::<f32>() / samples.len() as f32).sqrt()
}

pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0, |max, sample| max.max(sample.abs()))
}
