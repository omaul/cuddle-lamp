//! Рендер сцены в WAV: послушать и проверить сцену без телефона.

mod wav;

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use sound_core::{Scene, create};

use crate::wav::WavWriter;

const DEFAULT_SECONDS: f32 = 60.0;
const DEFAULT_SAMPLE_RATE: f32 = 48_000.0;
const BLOCK_FRAMES: usize = 512;

const USAGE: &str = "\
Рендер сцены в WAV.

Использование:
  sound-render <сцена.json> [параметры]

Параметры:
  -o, --out <файл.wav>      куда записать, по умолчанию <id сцены>.wav
  -s, --seconds <число>     длительность в секундах, по умолчанию 60
      --sample-rate <число> частота дискретизации, по умолчанию 48000
      --seed <число>        сид вместо сида из сцены
      --knob <id>=<0..1>    положение ручки, можно указать несколько раз
      --timer <секунды>     включить таймер, после него звук затихает за 20 секунд
  -h, --help                показать эту справку
";

struct Options {
    scene_path: PathBuf,
    output_path: Option<PathBuf>,
    seconds: f32,
    sample_rate: f32,
    seed: Option<u64>,
    knobs: Vec<(String, f32)>,
    timer_seconds: Option<f32>,
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if arguments.is_empty() || arguments.iter().any(|argument| argument == "-h" || argument == "--help") {
        print!("{USAGE}");
        return ExitCode::SUCCESS;
    }
    match parse_options(&arguments).and_then(|options| render(&options)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("Ошибка: {message}");
            ExitCode::FAILURE
        }
    }
}

fn parse_options(arguments: &[String]) -> Result<Options, String> {
    let mut options = Options {
        scene_path: PathBuf::new(),
        output_path: None,
        seconds: DEFAULT_SECONDS,
        sample_rate: DEFAULT_SAMPLE_RATE,
        seed: None,
        knobs: Vec::new(),
        timer_seconds: None,
    };
    let mut scene_path = None;
    let mut remaining = arguments.iter();
    while let Some(argument) = remaining.next() {
        let mut take_value = || remaining.next().ok_or_else(|| format!("у параметра {argument} нет значения"));
        match argument.as_str() {
            "-o" | "--out" => options.output_path = Some(PathBuf::from(take_value()?)),
            "-s" | "--seconds" => options.seconds = parse_number(argument, take_value()?)?,
            "--sample-rate" => options.sample_rate = parse_number(argument, take_value()?)?,
            "--seed" => options.seed = Some(parse_number(argument, take_value()?)?),
            "--timer" => options.timer_seconds = Some(parse_number(argument, take_value()?)?),
            "--knob" => {
                let value = take_value()?;
                let Some((knob_id, position)) = value.split_once('=') else {
                    return Err(format!("ручка задаётся как id=положение, получено «{value}»"));
                };
                options.knobs.push((knob_id.to_owned(), parse_number(argument, position)?));
            }
            _ if argument.starts_with('-') => return Err(format!("неизвестный параметр {argument}")),
            _ if scene_path.is_none() => scene_path = Some(PathBuf::from(argument)),
            _ => return Err(format!("лишний аргумент «{argument}»")),
        }
    }
    options.scene_path = scene_path.ok_or("не указан файл сцены")?;
    if options.seconds.is_nan() || options.seconds <= 0.0 {
        return Err("длительность должна быть больше нуля".to_owned());
    }
    Ok(options)
}

fn parse_number<T: std::str::FromStr>(argument: &str, value: &str) -> Result<T, String> {
    value.parse().map_err(|_| format!("значение «{value}» параметра {argument} не число"))
}

fn render(options: &Options) -> Result<(), String> {
    let json = std::fs::read_to_string(&options.scene_path)
        .map_err(|error| format!("не удалось прочитать {}: {error}", options.scene_path.display()))?;
    let mut scene = Scene::from_json(&json).map_err(|error| error.to_string())?;
    if let Some(seed) = options.seed {
        scene.seed = seed;
    }

    let (mut controller, mut processor) = create(options.sample_rate);
    controller.load_scene(&scene).map_err(|error| error.to_string())?;
    for (knob_id, position) in &options.knobs {
        controller.set_knob(knob_id, *position).map_err(|error| error.to_string())?;
    }
    controller.set_timer(options.timer_seconds).map_err(|error| error.to_string())?;
    controller.play().map_err(|error| error.to_string())?;

    let output_path = options.output_path.clone().unwrap_or_else(|| PathBuf::from(format!("{}.wav", scene.id)));
    let mut writer = WavWriter::create(&output_path, options.sample_rate as u32)
        .map_err(|error| format!("не удалось создать {}: {error}", output_path.display()))?;

    let total_frames = (options.seconds * options.sample_rate) as usize;
    let mut left = vec![0.0; BLOCK_FRAMES];
    let mut right = vec![0.0; BLOCK_FRAMES];
    let mut peak = 0.0f32;
    let mut sum_of_squares = 0.0f64;
    let started_at = Instant::now();
    let mut rendered_frames = 0;
    while rendered_frames < total_frames {
        let frame_count = BLOCK_FRAMES.min(total_frames - rendered_frames);
        let (left_block, right_block) = (&mut left[..frame_count], &mut right[..frame_count]);
        processor.render(left_block, right_block);
        for (left_sample, right_sample) in left_block.iter().zip(right_block.iter()) {
            peak = peak.max(left_sample.abs()).max(right_sample.abs());
            sum_of_squares += f64::from(left_sample * left_sample + right_sample * right_sample);
        }
        writer.write(left_block, right_block).map_err(|error| format!("ошибка записи: {error}"))?;
        rendered_frames += frame_count;
    }
    writer.finish().map_err(|error| format!("ошибка записи: {error}"))?;

    let elapsed_seconds = started_at.elapsed().as_secs_f32();
    let rms = (sum_of_squares / (2 * total_frames.max(1)) as f64).sqrt() as f32;
    println!("Сцена «{}» записана в {}", scene.name, output_path.display());
    println!(
        "Длительность {:.0} с, пик {:.1} dBFS, RMS {:.1} dBFS",
        options.seconds,
        to_decibels(peak),
        to_decibels(rms)
    );
    println!(
        "Рендер занял {:.2} с, это в {:.0} раз быстрее реального времени",
        elapsed_seconds,
        options.seconds / elapsed_seconds.max(f32::EPSILON)
    );
    println!("Состояние в конце: {:?}", controller.state().status);
    Ok(())
}

fn to_decibels(amplitude: f32) -> f32 {
    20.0 * amplitude.max(1e-9).log10()
}
