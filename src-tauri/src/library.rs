//! Sound-Bibliothek: SQLite-Datenbank plus kopierte Audiodateien im
//! App-Datenordner. Dekodierte Sounds liegen im Speicher bereit.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

use crate::audio::ENGINE_RATE;
use crate::audio::decode::{decode_file, waveform};
use crate::audio::sampler::PlayMode;
use crate::covers::{self, ImportMeta};

const WAVEFORM_BINS: usize = 160;

const COLORS: [&str; 8] = [
    "orange", "amber", "lime", "emerald", "cyan", "blue", "violet", "pink",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sound {
    pub id: i64,
    pub name: String,
    pub file: String,
    pub color: String,
    pub hotkey: Option<String>,
    pub volume_db: f32,
    pub category: Option<String>,
    pub favorite: bool,
    pub play_mode: PlayMode,
    pub trim_start_ms: u32,
    /// 0 = bis zum Ende.
    pub trim_end_ms: u32,
    pub fade_in_ms: u32,
    pub fade_out_ms: u32,
    pub duration_ms: u32,
    pub waveform: Vec<u8>,
    /// Absoluter Pfad zum Cover-Bild.
    pub cover: Option<String>,
}

/// Änderbare Felder; was fehlt, bleibt unverändert.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SoundPatch {
    pub name: Option<String>,
    pub color: Option<String>,
    /// `Some(None)` entfernt den Hotkey.
    #[serde(default, with = "double_option")]
    pub hotkey: Option<Option<String>>,
    pub volume_db: Option<f32>,
    #[serde(default, with = "double_option")]
    pub category: Option<Option<String>>,
    pub favorite: Option<bool>,
    pub play_mode: Option<PlayMode>,
    pub trim_start_ms: Option<u32>,
    pub trim_end_ms: Option<u32>,
    pub fade_in_ms: Option<u32>,
    pub fade_out_ms: Option<u32>,
}

mod double_option {
    use serde::{Deserialize, Deserializer};

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
    where
        T: Deserialize<'de>,
        D: Deserializer<'de>,
    {
        Option::<T>::deserialize(deserializer).map(Some)
    }
}

pub struct Library {
    db: Mutex<Connection>,
    sounds_dir: PathBuf,
    covers_dir: PathBuf,
    cache: Mutex<HashMap<i64, Arc<[f32]>>>,
}

fn play_mode_to_str(mode: PlayMode) -> &'static str {
    match mode {
        PlayMode::Restart => "restart",
        PlayMode::Overlap => "overlap",
        PlayMode::Toggle => "toggle",
    }
}

fn play_mode_from_str(mode: &str) -> PlayMode {
    match mode {
        "overlap" => PlayMode::Overlap,
        "toggle" => PlayMode::Toggle,
        _ => PlayMode::Restart,
    }
}

fn sound_from_row(row: &Row) -> rusqlite::Result<Sound> {
    Ok(Sound {
        id: row.get("id")?,
        name: row.get("name")?,
        file: row.get("file")?,
        color: row.get("color")?,
        hotkey: row.get("hotkey")?,
        volume_db: row.get("volume_db")?,
        category: row.get("category")?,
        favorite: row.get("favorite")?,
        play_mode: play_mode_from_str(&row.get::<_, String>("play_mode")?),
        trim_start_ms: row.get("trim_start_ms")?,
        trim_end_ms: row.get("trim_end_ms")?,
        fade_in_ms: row.get("fade_in_ms")?,
        fade_out_ms: row.get("fade_out_ms")?,
        duration_ms: row.get("duration_ms")?,
        waveform: row.get("waveform")?,
        cover: row.get("cover")?,
    })
}

/// Dateiname ohne Endung, Unterstriche als Leerzeichen.
fn display_name(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Sound")
        .replace(['_', '-'], " ")
        .trim()
        .to_string()
}

fn ms_to_samples(ms: u32) -> usize {
    ms as usize * ENGINE_RATE as usize / 1000
}

impl Library {
    pub fn open(data_dir: &Path) -> anyhow::Result<Self> {
        let sounds_dir = data_dir.join("sounds");
        fs::create_dir_all(&sounds_dir)?;
        let db = Connection::open(data_dir.join("ode.db"))?;
        db.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS sounds (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL,
                 file TEXT NOT NULL,
                 color TEXT NOT NULL,
                 hotkey TEXT,
                 volume_db REAL NOT NULL DEFAULT 0,
                 category TEXT,
                 favorite INTEGER NOT NULL DEFAULT 0,
                 play_mode TEXT NOT NULL DEFAULT 'restart',
                 trim_start_ms INTEGER NOT NULL DEFAULT 0,
                 trim_end_ms INTEGER NOT NULL DEFAULT 0,
                 fade_in_ms INTEGER NOT NULL DEFAULT 0,
                 fade_out_ms INTEGER NOT NULL DEFAULT 0,
                 duration_ms INTEGER NOT NULL,
                 waveform BLOB NOT NULL,
                 created_at INTEGER NOT NULL DEFAULT (unixepoch())
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );",
        )?;
        covers::ensure_column(&db, "sounds", "cover", "TEXT")?;
        Ok(Self {
            db: Mutex::new(db),
            covers_dir: data_dir.join("covers"),
            sounds_dir,
            cache: Mutex::new(HashMap::new()),
        })
    }

    pub fn setting(&self, key: &str) -> Option<String> {
        self.db
            .lock()
            .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .ok()
            .flatten()
    }

    pub fn set_setting(&self, key: &str, value: &str) -> anyhow::Result<()> {
        self.db.lock().execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn list(&self) -> anyhow::Result<Vec<Sound>> {
        let db = self.db.lock();
        let mut stmt = db.prepare("SELECT * FROM sounds ORDER BY id")?;
        let sounds = stmt
            .query_map([], sound_from_row)?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(sounds)
    }

    pub fn get(&self, id: i64) -> anyhow::Result<Sound> {
        self.db
            .lock()
            .query_row("SELECT * FROM sounds WHERE id = ?1", [id], sound_from_row)
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("Sound {id} nicht gefunden"))
    }

    /// Kopiert die Datei in die Bibliothek und legt den Sound an.
    pub fn import(&self, source: &Path) -> anyhow::Result<Sound> {
        self.import_with(source, &ImportMeta::default())
    }

    /// Import mit Name und Cover aus einem Download oder einer anderen Bibliothek.
    pub fn import_with(&self, source: &Path, meta: &ImportMeta) -> anyhow::Result<Sound> {
        let samples: Arc<[f32]> = decode_file(source)?.into();
        let duration_ms = (samples.len() as u64 * 1000 / ENGINE_RATE as u64) as u32;
        let peaks = waveform(&samples, WAVEFORM_BINS);

        let ext = source
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("audio")
            .to_lowercase();
        let file = format!(
            "{}.{ext}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)?
                .as_nanos()
        );
        fs::copy(source, self.sounds_dir.join(&file))?;
        let cover = covers::store(&self.covers_dir, source, meta);
        let name = meta.name.clone().unwrap_or_else(|| display_name(source));

        let id = {
            let db = self.db.lock();
            let count: i64 = db.query_row("SELECT COUNT(*) FROM sounds", [], |r| r.get(0))?;
            let color = COLORS[count as usize % COLORS.len()];
            db.execute(
                "INSERT INTO sounds (name, file, color, duration_ms, waveform, cover)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![name, file, color, duration_ms, peaks, cover],
            )?;
            db.last_insert_rowid()
        };
        self.cache.lock().insert(id, samples);
        self.get(id)
    }

    pub fn update(&self, id: i64, patch: SoundPatch) -> anyhow::Result<Sound> {
        let mut sound = self.get(id)?;
        if let Some(v) = patch.name {
            sound.name = v;
        }
        if let Some(v) = patch.color {
            sound.color = v;
        }
        if let Some(v) = patch.hotkey {
            sound.hotkey = v.filter(|h| !h.is_empty());
        }
        if let Some(v) = patch.volume_db {
            sound.volume_db = v.clamp(-60.0, 12.0);
        }
        if let Some(v) = patch.category {
            sound.category = v.filter(|c| !c.trim().is_empty());
        }
        if let Some(v) = patch.favorite {
            sound.favorite = v;
        }
        if let Some(v) = patch.play_mode {
            sound.play_mode = v;
        }
        if let Some(v) = patch.trim_start_ms {
            sound.trim_start_ms = v.min(sound.duration_ms);
        }
        if let Some(v) = patch.trim_end_ms {
            sound.trim_end_ms = v.min(sound.duration_ms);
        }
        if let Some(v) = patch.fade_in_ms {
            sound.fade_in_ms = v;
        }
        if let Some(v) = patch.fade_out_ms {
            sound.fade_out_ms = v;
        }

        self.db.lock().execute(
            "UPDATE sounds SET name = ?2, color = ?3, hotkey = ?4, volume_db = ?5,
                 category = ?6, favorite = ?7, play_mode = ?8, trim_start_ms = ?9,
                 trim_end_ms = ?10, fade_in_ms = ?11, fade_out_ms = ?12
             WHERE id = ?1",
            params![
                id,
                sound.name,
                sound.color,
                sound.hotkey,
                sound.volume_db,
                sound.category,
                sound.favorite,
                play_mode_to_str(sound.play_mode),
                sound.trim_start_ms,
                sound.trim_end_ms,
                sound.fade_in_ms,
                sound.fade_out_ms,
            ],
        )?;
        Ok(sound)
    }

    pub fn delete(&self, id: i64) -> anyhow::Result<()> {
        let sound = self.get(id)?;
        self.db
            .lock()
            .execute("DELETE FROM sounds WHERE id = ?1", [id])?;
        self.cache.lock().remove(&id);
        let _ = fs::remove_file(self.sounds_dir.join(&sound.file));
        covers::remove(sound.cover.as_deref());
        Ok(())
    }

    /// Pfad der Audiodatei in der Bibliothek.
    pub fn file_path(&self, sound: &Sound) -> PathBuf {
        self.sounds_dir.join(&sound.file)
    }

    /// Dekodierte Samples, bei Bedarf von der Platte geladen.
    pub fn samples(&self, sound: &Sound) -> anyhow::Result<Arc<[f32]>> {
        if let Some(samples) = self.cache.lock().get(&sound.id) {
            return Ok(samples.clone());
        }
        let samples: Arc<[f32]> = decode_file(&self.sounds_dir.join(&sound.file))?.into();
        self.cache.lock().insert(sound.id, samples.clone());
        Ok(samples)
    }

    /// Lädt alle Sounds vorab, damit der erste Druck sofort klingt.
    pub fn preload(&self) {
        for sound in self.list().unwrap_or_default() {
            let _ = self.samples(&sound);
        }
    }

    pub fn play_request(
        &self,
        sound: &Sound,
    ) -> anyhow::Result<crate::audio::sampler::PlayRequest> {
        let samples = self.samples(sound)?;
        let len = samples.len();
        let start = ms_to_samples(sound.trim_start_ms).min(len);
        let end = if sound.trim_end_ms == 0 {
            len
        } else {
            ms_to_samples(sound.trim_end_ms).clamp(start, len)
        };
        Ok(crate::audio::sampler::PlayRequest {
            sound_id: sound.id,
            samples,
            start,
            end,
            gain: crate::audio::dsp::db_to_gain(sound.volume_db),
            fade_in: ms_to_samples(sound.fade_in_ms),
            fade_out: ms_to_samples(sound.fade_out_ms),
            mode: sound.play_mode,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip() {
        let dir = std::env::temp_dir().join(format!("ode-settings-test-{}", std::process::id()));
        let library = Library::open(&dir).unwrap();
        assert_eq!(library.setting("mixer"), None);
        library.set_setting("mixer", "{\"a\":1}").unwrap();
        library.set_setting("mixer", "{\"a\":2}").unwrap();
        assert_eq!(library.setting("mixer").as_deref(), Some("{\"a\":2}"));
        drop(library);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
