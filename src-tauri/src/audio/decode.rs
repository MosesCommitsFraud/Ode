//! Lädt Audiodateien vollständig in den Speicher: Mono, 48 kHz, f32.

use std::fs::File;
use std::path::Path;

use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

use super::ENGINE_RATE;
use super::resample::PushResampler;

pub fn decode_file(path: &Path) -> anyhow::Result<Vec<f32>> {
    let file = File::open(path)?;
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .map_err(|e| anyhow::anyhow!("Format nicht erkannt: {e}"))?;
    let track = format
        .default_track(TrackType::Audio)
        .ok_or_else(|| anyhow::anyhow!("Keine Tonspur gefunden"))?;
    let track_id = track.id;
    let params = track
        .codec_params
        .as_ref()
        .and_then(|p| p.audio())
        .ok_or_else(|| anyhow::anyhow!("Keine Tonspur gefunden"))?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|e| anyhow::anyhow!("Codec nicht unterstützt: {e}"))?;

    let mut mono = Vec::new();
    let mut interleaved: Vec<f32> = Vec::new();
    let mut resampler: Option<(u32, PushResampler)> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(Some(packet)) => packet,
            Ok(None) => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(e.into()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buffer = match decoder.decode(&packet) {
            Ok(buffer) => buffer,
            // Einzelne kaputte Pakete überspringen.
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(e.into()),
        };
        let rate = buffer.spec().rate();
        let channels = buffer.spec().channels().count().max(1);
        interleaved.resize(buffer.samples_interleaved(), 0.0);
        buffer.copy_to_slice_interleaved(&mut interleaved);

        if resampler.as_ref().is_none_or(|(r, _)| *r != rate) {
            resampler = Some((rate, PushResampler::new(rate, ENGINE_RATE)));
        }
        let (_, resampler) = resampler.as_mut().expect("gerade gesetzt");
        let scale = 1.0 / channels as f32;
        let frames = interleaved
            .chunks_exact(channels)
            .map(|f| f.iter().sum::<f32>() * scale);
        if resampler.is_passthrough() {
            mono.extend(frames);
        } else {
            let block: Vec<f32> = frames.collect();
            resampler.process(&block, |s| mono.push(s));
        }
    }

    anyhow::ensure!(!mono.is_empty(), "Datei enthält keinen Ton");
    Ok(mono)
}

/// Eingebettetes Bild (Album-Cover) einer Audiodatei: Bytes und MIME-Typ.
pub fn embedded_cover(path: &Path) -> Option<(Vec<u8>, Option<String>)> {
    let file = File::open(path).ok()?;
    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(
            &hint,
            source,
            FormatOptions::default(),
            MetadataOptions::default(),
        )
        .ok()?;
    let mut metadata = format.metadata();
    let mut visuals = Vec::new();
    if let Some(rev) = metadata.current() {
        visuals.extend(rev.media.visuals.iter().cloned());
    }
    if let Some(rev) = metadata.skip_to_latest() {
        visuals.extend(rev.media.visuals.iter().cloned());
    }
    let best = visuals
        .iter()
        .find(|v| {
            matches!(
                v.usage,
                Some(symphonia::core::meta::StandardVisualKey::FrontCover)
            )
        })
        .or_else(|| visuals.first())?;
    Some((best.data.to_vec(), best.media_type.clone()))
}

/// Spitzenwerte für die Wellenform-Anzeige, 0–255 pro Abschnitt.
pub fn waveform(samples: &[f32], bins: usize) -> Vec<u8> {
    if samples.is_empty() {
        return vec![0; bins];
    }
    let chunk = samples.len().div_ceil(bins).max(1);
    let peaks: Vec<f32> = samples
        .chunks(chunk)
        .map(|c| c.iter().fold(0.0f32, |m, s| m.max(s.abs())))
        .collect();
    let max = peaks.iter().cloned().fold(1e-6, f32::max);
    let mut out: Vec<u8> = peaks
        .iter()
        .map(|p| ((p / max).sqrt() * 255.0).round() as u8)
        .collect();
    out.resize(bins, 0);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Schreibt eine 16-Bit-Stereo-WAV mit 44,1 kHz.
    fn write_wav(path: &Path, frames: usize) {
        let rate = 44_100u32;
        let data_len = (frames * 4) as u32;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..frames {
            let s = ((i as f32 * 0.05).sin() * 16_000.0) as i16;
            bytes.extend_from_slice(&s.to_le_bytes());
            bytes.extend_from_slice(&s.to_le_bytes());
        }
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn decodes_wav_to_engine_rate_mono() {
        let path = std::env::temp_dir().join("ode-decode-test.wav");
        write_wav(&path, 44_100);
        let samples = decode_file(&path).unwrap();
        let _ = std::fs::remove_file(&path);
        assert!(
            (samples.len() as i64 - 48_000).abs() <= 2,
            "{}",
            samples.len()
        );
        let peak = samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((peak - 0.49).abs() < 0.02, "{peak}");
        assert_eq!(waveform(&samples, 160).len(), 160);
    }
}
