//! Cover-Bilder für Sounds und Titel: quadratisch zugeschnitten, als Datei im
//! App-Datenordner. Die Oberfläche lädt sie per `convertFileSrc(pfad)`.

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use crate::audio::decode::embedded_cover;
use crate::downloader::hidden_command;

/// Kantenlänge der gespeicherten Cover.
const SIZE: u32 = 512;

/// Woher ein Cover beim Import kommt.
#[derive(Debug, Clone, Default)]
pub struct ImportMeta {
    /// Name bzw. Titel statt des Dateinamens.
    pub name: Option<String>,
    pub artist: Option<String>,
    /// Fertiges Cover-Bild (wird kopiert).
    pub cover: Option<PathBuf>,
    /// Zum Zuschneiden eingebetteter Bilder, falls vorhanden.
    pub ffmpeg: Option<PathBuf>,
}

fn unique(ext: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos}.{ext}")
}

/// Schneidet ein Bild mit FFmpeg quadratisch auf 512×512 zu (JPEG).
pub fn square(ffmpeg: &Path, source: &Path, target: &Path) -> anyhow::Result<()> {
    let filter = format!("crop='min(iw,ih)':'min(iw,ih)',scale={SIZE}:{SIZE}");
    let status = hidden_command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(source)
        .args(["-vf", &filter, "-frames:v", "1", "-q:v", "3"])
        .arg(target)
        .status()?;
    anyhow::ensure!(
        status.success() && target.is_file(),
        "Cover konnte nicht zugeschnitten werden"
    );
    Ok(())
}

/// Legt das Cover für einen Import ab: übergebenes Bild kopieren, sonst das in
/// der Audiodatei eingebettete Bild übernehmen. `None`, wenn es keins gibt.
pub fn store(covers_dir: &Path, audio: &Path, meta: &ImportMeta) -> Option<String> {
    fs::create_dir_all(covers_dir).ok()?;
    if let Some(cover) = &meta.cover {
        let ext = cover.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
        let target = covers_dir.join(unique(ext));
        fs::copy(cover, &target).ok()?;
        return Some(target.to_string_lossy().into_owned());
    }
    let (bytes, media_type) = embedded_cover(audio)?;
    let ext = match media_type.as_deref() {
        Some("image/png") => "png",
        Some("image/webp") => "webp",
        _ => "jpg",
    };
    let raw = covers_dir.join(unique(ext));
    fs::write(&raw, bytes).ok()?;
    if let Some(ffmpeg) = meta.ffmpeg.as_deref().filter(|f| f.is_file()) {
        let target = covers_dir.join(unique("jpg"));
        if square(ffmpeg, &raw, &target).is_ok() {
            let _ = fs::remove_file(&raw);
            return Some(target.to_string_lossy().into_owned());
        }
    }
    Some(raw.to_string_lossy().into_owned())
}

pub fn remove(cover: Option<&str>) {
    if let Some(path) = cover {
        let _ = fs::remove_file(path);
    }
}

/// Ergänzt eine Spalte in bestehenden Datenbanken.
pub fn ensure_column(
    db: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> rusqlite::Result<()> {
    let exists = db
        .prepare(&format!("PRAGMA table_info({table})"))?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(Result::ok)
        .any(|name| name == column);
    if !exists {
        db.execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))?;
    }
    Ok(())
}
