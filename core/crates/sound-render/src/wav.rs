use std::fs::File;
use std::io::{self, BufWriter, Seek, SeekFrom, Write};
use std::path::Path;

const CHANNEL_COUNT: u16 = 2;
const BITS_PER_SAMPLE: u16 = 16;
const BYTES_PER_FRAME: u32 = (CHANNEL_COUNT * BITS_PER_SAMPLE / 8) as u32;

/// Пишет стерео WAV (16 бит) потоком, чтобы длинный рендер не держать целиком в памяти.
pub struct WavWriter {
    writer: BufWriter<File>,
    sample_rate: u32,
    frames_written: u32,
}

impl WavWriter {
    pub fn create(path: &Path, sample_rate: u32) -> io::Result<Self> {
        let mut writer = BufWriter::new(File::create(path)?);
        write_header(&mut writer, sample_rate, 0)?;
        Ok(Self { writer, sample_rate, frames_written: 0 })
    }

    pub fn write(&mut self, left: &[f32], right: &[f32]) -> io::Result<()> {
        for (left_sample, right_sample) in left.iter().zip(right) {
            for sample in [left_sample, right_sample] {
                let value = (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
                self.writer.write_all(&value.to_le_bytes())?;
            }
        }
        self.frames_written += left.len().min(right.len()) as u32;
        Ok(())
    }

    /// Дописывает в заголовок итоговый размер данных.
    pub fn finish(mut self) -> io::Result<()> {
        self.writer.seek(SeekFrom::Start(0))?;
        write_header(&mut self.writer, self.sample_rate, self.frames_written * BYTES_PER_FRAME)?;
        self.writer.flush()
    }
}

fn write_header(writer: &mut impl Write, sample_rate: u32, data_bytes: u32) -> io::Result<()> {
    const FORMAT_CHUNK_SIZE: u32 = 16;
    const PCM_FORMAT: u16 = 1;
    writer.write_all(b"RIFF")?;
    writer.write_all(&(36 + data_bytes).to_le_bytes())?;
    writer.write_all(b"WAVE")?;
    writer.write_all(b"fmt ")?;
    writer.write_all(&FORMAT_CHUNK_SIZE.to_le_bytes())?;
    writer.write_all(&PCM_FORMAT.to_le_bytes())?;
    writer.write_all(&CHANNEL_COUNT.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&(sample_rate * BYTES_PER_FRAME).to_le_bytes())?;
    writer.write_all(&(BYTES_PER_FRAME as u16).to_le_bytes())?;
    writer.write_all(&BITS_PER_SAMPLE.to_le_bytes())?;
    writer.write_all(b"data")?;
    writer.write_all(&data_bytes.to_le_bytes())
}
