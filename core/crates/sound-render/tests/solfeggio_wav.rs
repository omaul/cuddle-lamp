use std::fs;
use std::path::{Path, PathBuf};
use std::process::{self, Command};
use std::time::{SystemTime, UNIX_EPOCH};

const SAMPLE_RATE: usize = 48_000;
const FREQUENCIES: [u32; 9] = [174, 285, 396, 417, 528, 639, 741, 852, 963];

struct RenderDirectory(PathBuf);

impl RenderDirectory {
    fn create() -> Self {
        let timestamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("cuddle-lamp-solfeggio-{}-{timestamp}", process::id()));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for RenderDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn find_chunk<'a>(file: &'a [u8], chunk_id: &[u8; 4]) -> &'a [u8] {
    assert_eq!(&file[..4], b"RIFF");
    assert_eq!(&file[8..12], b"WAVE");
    let mut start = 12;
    while let Some(header) = file.get(start..start + 8) {
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
        let end = start + 8 + length;
        if &header[..4] == chunk_id {
            return &file[start + 8..end];
        }
        start = end + length % 2;
    }
    panic!("В WAV отсутствует блок {}", String::from_utf8_lossy(chunk_id));
}

fn measure_frequency(wav: &[u8]) -> f64 {
    let format = find_chunk(wav, b"fmt ");
    let encoding = u16::from_le_bytes(format[..2].try_into().unwrap());
    let sample_rate = u32::from_le_bytes(format[4..8].try_into().unwrap()) as usize;
    let frame_bytes = u16::from_le_bytes(format[12..14].try_into().unwrap()) as usize;
    let sample_bits = u16::from_le_bytes(format[14..16].try_into().unwrap()) as usize;
    assert_eq!(sample_rate, SAMPLE_RATE);
    assert!(matches!((encoding, sample_bits), (1, 16 | 24 | 32) | (3, 32)));

    let data = find_chunk(wav, b"data");
    // Старший бит определяет знак и для PCM со знаком, и для 32-битных чисел с плавающей точкой.
    let negative = |frame: &[u8]| frame[sample_bits / 8 - 1] & 0x80 != 0;
    let mut first_crossing = None;
    let mut last_crossing = 0;
    let mut crossings = 0;
    let mut previous_was_negative = false;
    for (index, frame) in data.chunks_exact(frame_bytes).skip(SAMPLE_RATE / 2).take(SAMPLE_RATE * 2).enumerate() {
        let is_negative = negative(frame);
        if previous_was_negative && !is_negative {
            first_crossing.get_or_insert(index);
            last_crossing = index;
            crossings += 1;
        }
        previous_was_negative = is_negative;
    }
    assert!(crossings > 1, "В WAV не найден периодический сигнал");
    (crossings - 1) as f64 * sample_rate as f64 / (last_crossing - first_crossing.unwrap()) as f64
}

#[test]
fn exported_wav_contains_each_exact_preset_frequency() {
    let directory = RenderDirectory::create();
    let scene = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../scenes/solfeggio.json");
    for (index, frequency) in FREQUENCIES.into_iter().enumerate() {
        let wav = directory.0.join(format!("{frequency}.wav"));
        let mut render = Command::new(env!("CARGO_BIN_EXE_sound-render"));
        render.arg(&scene).args(["-s", "3", "--sample-rate", "48000", "-o"]).arg(&wav);
        if frequency != 528 {
            render.arg("--knob").arg(format!("frequency={}", index as f64 / 8.0));
        }
        let output = render.output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let measured = measure_frequency(&fs::read(wav).unwrap());
        assert!((measured - f64::from(frequency)).abs() < 1.0, "Пресет {frequency} Гц дал {measured:.3} Гц");
    }
}
