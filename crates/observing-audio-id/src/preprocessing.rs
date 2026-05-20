//! Audio preprocessing for Perch 2.0 inference.
//!
//! Perch 2.0 expects 5-second windows of mono PCM at 32 kHz, with the mel
//! spectrogram computed inside the exported ONNX graph (Justin Chu's
//! community ONNX bundle). Clips that are shorter are zero-padded; longer
//! clips are split into overlapping windows that the caller scores
//! independently and then max-pools per species (handled in `model.rs`).
//!
//! Pipeline:
//! 1. Decode container + codec via `symphonia` (wav/mp3/flac/ogg).
//! 2. Downmix to mono (mean across channels).
//! 3. Resample to 32 kHz via `rubato` (sinc kernel).
//! 4. Frame into 5-second windows with `WINDOW_HOP_SECS` overlap.

use crate::error::{AudioIdError, Result};
use ndarray::Array2;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use tracing::debug;

/// Perch 2.0 sample rate.
pub const TARGET_SR: u32 = 32_000;
/// Window length the model expects.
pub const WINDOW_SECS: f32 = 5.0;
/// Hop between successive windows when the clip is longer than `WINDOW_SECS`.
/// 50% overlap so a vocalization that straddles a frame boundary still has a
/// frame where it's fully inside the window.
pub const WINDOW_HOP_SECS: f32 = 2.5;

/// Samples per window: 5s * 32kHz = 160_000.
pub const WINDOW_SAMPLES: usize = (TARGET_SR as f32 * WINDOW_SECS) as usize;

/// Result of decoding + framing a clip.
pub struct FramedAudio {
    /// Shape `[num_frames, WINDOW_SAMPLES]`, mono f32 in [-1, 1].
    pub frames: Array2<f32>,
    /// Original decoded duration in seconds (pre-framing). Surfaced in the
    /// response so the appview can warn on absurdly short / long uploads.
    pub duration_secs: f32,
}

/// Decode raw audio bytes and split into Perch-compatible 5s frames.
pub fn preprocess_audio(bytes: &[u8]) -> Result<FramedAudio> {
    let mono = decode_to_mono_f32(bytes)?;
    let duration_secs = mono.len() as f32 / TARGET_SR as f32;
    let frames = frame(&mono);
    debug!(
        samples = mono.len(),
        duration_secs,
        frames = frames.shape()[0],
        "Audio preprocessed"
    );
    Ok(FramedAudio {
        frames,
        duration_secs,
    })
}

/// Decode any symphonia-supported container, downmix to mono, resample to
/// `TARGET_SR`. Returns f32 PCM in [-1, 1].
fn decode_to_mono_f32(bytes: &[u8]) -> Result<Vec<f32>> {
    let cursor = std::io::Cursor::new(bytes.to_vec());
    let mss = MediaSourceStream::new(Box::new(cursor), Default::default());

    let probed = symphonia::default::get_probe()
        .format(
            &Hint::new(),
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AudioIdError::Audio(format!("probe failed: {}", e)))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| AudioIdError::Audio("no default track".into()))?;
    let track_id = track.id;
    let codec_params = track.codec_params.clone();
    let source_sr = codec_params
        .sample_rate
        .ok_or_else(|| AudioIdError::Audio("unknown sample rate".into()))?;
    let channels = codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1)
        .max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| AudioIdError::Audio(format!("decoder init: {}", e)))?;

    let mut interleaved: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => return Err(AudioIdError::Audio(format!("packet read: {}", e))),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|e| AudioIdError::Audio(format!("decode: {}", e)))?;
        if sample_buf.is_none() {
            sample_buf = Some(SampleBuffer::<f32>::new(
                decoded.capacity() as u64,
                *decoded.spec(),
            ));
        }
        let buf = sample_buf.as_mut().unwrap();
        buf.copy_interleaved_ref(decoded);
        interleaved.extend_from_slice(buf.samples());
    }

    // Downmix to mono by averaging channels.
    let mono: Vec<f32> = if channels == 1 {
        interleaved
    } else {
        interleaved
            .chunks_exact(channels)
            .map(|c| c.iter().sum::<f32>() / channels as f32)
            .collect()
    };

    // Resample to TARGET_SR if needed.
    if source_sr == TARGET_SR {
        return Ok(mono);
    }
    resample_to_target(&mono, source_sr, TARGET_SR)
}

/// Resample `input` from `source_sr` to `target_sr` using rubato's sinc
/// resampler. We use the fixed-output-size variant in chunks because audio
/// length isn't known in advance to the model — this keeps the call
/// straightforward and the math is the same.
fn resample_to_target(input: &[f32], source_sr: u32, target_sr: u32) -> Result<Vec<f32>> {
    use rubato::{
        Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction,
    };

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        interpolation: SincInterpolationType::Linear,
        oversampling_factor: 256,
        window: WindowFunction::BlackmanHarris2,
    };

    let ratio = target_sr as f64 / source_sr as f64;
    let chunk_size = 4096;
    let mut resampler = SincFixedIn::<f32>::new(ratio, 1.0, params, chunk_size, 1)
        .map_err(|e| AudioIdError::Audio(format!("rubato init: {}", e)))?;

    let mut out: Vec<f32> = Vec::with_capacity((input.len() as f64 * ratio) as usize);
    let mut pos = 0;
    while pos + chunk_size <= input.len() {
        let chunk = vec![input[pos..pos + chunk_size].to_vec()];
        let resampled = resampler
            .process(&chunk, None)
            .map_err(|e| AudioIdError::Audio(format!("rubato process: {}", e)))?;
        out.extend_from_slice(&resampled[0]);
        pos += chunk_size;
    }
    // Tail: zero-pad to a full chunk so rubato can flush it.
    if pos < input.len() {
        let mut tail = vec![0.0f32; chunk_size];
        tail[..input.len() - pos].copy_from_slice(&input[pos..]);
        let chunk = vec![tail];
        let resampled = resampler
            .process(&chunk, None)
            .map_err(|e| AudioIdError::Audio(format!("rubato tail: {}", e)))?;
        // Trim the padding-derived samples we don't actually need.
        let keep = ((input.len() - pos) as f64 * ratio) as usize;
        out.extend_from_slice(&resampled[0][..keep.min(resampled[0].len())]);
    }
    Ok(out)
}

/// Frame mono PCM into overlapping `WINDOW_SAMPLES`-long windows. Short
/// clips become a single zero-padded frame.
fn frame(mono: &[f32]) -> Array2<f32> {
    if mono.len() <= WINDOW_SAMPLES {
        let mut frame = Array2::<f32>::zeros((1, WINDOW_SAMPLES));
        for (i, &s) in mono.iter().enumerate() {
            frame[[0, i]] = s;
        }
        return frame;
    }
    let hop = (TARGET_SR as f32 * WINDOW_HOP_SECS) as usize;
    let num_frames = ((mono.len() - WINDOW_SAMPLES) / hop) + 1;
    let mut frames = Array2::<f32>::zeros((num_frames, WINDOW_SAMPLES));
    for f in 0..num_frames {
        let start = f * hop;
        for i in 0..WINDOW_SAMPLES {
            frames[[f, i]] = mono[start + i];
        }
    }
    frames
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_clip_becomes_one_padded_frame() {
        let mono = vec![0.5f32; TARGET_SR as usize]; // 1 second
        let frames = frame(&mono);
        assert_eq!(frames.shape(), &[1, WINDOW_SAMPLES]);
        assert!((frames[[0, 0]] - 0.5).abs() < 1e-6);
        assert_eq!(frames[[0, WINDOW_SAMPLES - 1]], 0.0); // padded
    }

    #[test]
    fn ten_second_clip_yields_overlapping_frames() {
        let mono = vec![0.0f32; (TARGET_SR as f32 * 10.0) as usize];
        let frames = frame(&mono);
        // (10s - 5s window) / 2.5s hop + 1 = 3 frames
        assert_eq!(frames.shape()[0], 3);
    }
}
