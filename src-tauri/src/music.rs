//! Musik: Titel und Playlists in SQLite, dazu die Player-Steuerung mit
//! Warteschlange, Zufall und Wiederholen. Abgespielt wird im Musik-Deck der
//! Engine; die Steuerung lädt Titel im Hintergrund und springt am Ende weiter.

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

use parking_lot::Mutex;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::audio::ENGINE_RATE;
use crate::audio::deck::DeckCommand;
use crate::audio::decode::decode_file;
use crate::audio::engine::Engine;
use crate::covers::{self, ImportMeta};

/// So viele dekodierte Titel bleiben im Speicher (aktueller, nächster, letzter).
const CACHE_TRACKS: usize = 3;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub title: String,
    pub artist: Option<String>,
    pub file: String,
    pub duration_ms: u32,
    /// Absoluter Pfad zum Cover-Bild.
    pub cover: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub track_ids: Vec<i64>,
}

pub struct MusicLibrary {
    db: Mutex<Connection>,
    music_dir: PathBuf,
    covers_dir: PathBuf,
    cache: Mutex<VecDeque<(i64, Arc<[f32]>)>>,
}

/// „Künstler - Titel.mp3“ → (Titel, Künstler).
fn title_and_artist(path: &Path) -> (String, Option<String>) {
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Titel")
        .replace('_', " ");
    match stem.split_once(" - ") {
        Some((artist, title)) if !artist.trim().is_empty() && !title.trim().is_empty() => {
            (title.trim().to_string(), Some(artist.trim().to_string()))
        }
        _ => (stem.trim().to_string(), None),
    }
}

impl MusicLibrary {
    pub fn open(data_dir: &Path) -> anyhow::Result<Self> {
        let music_dir = data_dir.join("music");
        fs::create_dir_all(&music_dir)?;
        let db = Connection::open(data_dir.join("ode.db"))?;
        db.execute_batch(
            "PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS tracks (
                 id INTEGER PRIMARY KEY,
                 title TEXT NOT NULL,
                 artist TEXT,
                 file TEXT NOT NULL,
                 duration_ms INTEGER NOT NULL,
                 created_at INTEGER NOT NULL DEFAULT (unixepoch())
             );
             CREATE TABLE IF NOT EXISTS playlists (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS playlist_tracks (
                 playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
                 track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
                 position INTEGER NOT NULL
             );",
        )?;
        covers::ensure_column(&db, "tracks", "cover", "TEXT")?;
        Ok(Self {
            db: Mutex::new(db),
            covers_dir: data_dir.join("covers"),
            music_dir,
            cache: Mutex::new(VecDeque::new()),
        })
    }

    pub fn tracks(&self) -> anyhow::Result<Vec<Track>> {
        let db = self.db.lock();
        let mut stmt = db.prepare(
            "SELECT id, title, artist, file, duration_ms, cover FROM tracks ORDER BY id",
        )?;
        let tracks = stmt
            .query_map([], |r| {
                Ok(Track {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    artist: r.get(2)?,
                    file: r.get(3)?,
                    duration_ms: r.get(4)?,
                    cover: r.get(5)?,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(tracks)
    }

    pub fn track(&self, id: i64) -> anyhow::Result<Track> {
        self.db
            .lock()
            .query_row(
                "SELECT id, title, artist, file, duration_ms, cover FROM tracks WHERE id = ?1",
                [id],
                |r| {
                    Ok(Track {
                        id: r.get(0)?,
                        title: r.get(1)?,
                        artist: r.get(2)?,
                        file: r.get(3)?,
                        duration_ms: r.get(4)?,
                        cover: r.get(5)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| anyhow::anyhow!("Titel {id} nicht gefunden"))
    }

    pub fn import(&self, source: &Path) -> anyhow::Result<Track> {
        self.import_with(source, &ImportMeta::default())
    }

    /// Import mit Titel, Künstler und Cover aus einem Download oder dem Soundboard.
    pub fn import_with(&self, source: &Path, meta: &ImportMeta) -> anyhow::Result<Track> {
        let samples: Arc<[f32]> = decode_file(source)?.into();
        let duration_ms = (samples.len() as u64 * 1000 / ENGINE_RATE as u64) as u32;
        let (file_title, file_artist) = title_and_artist(source);
        let title = meta.name.clone().unwrap_or(file_title);
        let artist = meta.artist.clone().or(file_artist);
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
        fs::copy(source, self.music_dir.join(&file))?;
        let cover = covers::store(&self.covers_dir, source, meta);
        let id = {
            let db = self.db.lock();
            db.execute(
                "INSERT INTO tracks (title, artist, file, duration_ms, cover)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![title, artist, file, duration_ms, cover],
            )?;
            db.last_insert_rowid()
        };
        self.remember(id, samples);
        self.track(id)
    }

    pub fn delete_track(&self, id: i64) -> anyhow::Result<()> {
        let track = self.track(id)?;
        self.db
            .lock()
            .execute("DELETE FROM tracks WHERE id = ?1", [id])?;
        self.cache.lock().retain(|(t, _)| *t != id);
        let _ = fs::remove_file(self.music_dir.join(&track.file));
        covers::remove(track.cover.as_deref());
        Ok(())
    }

    /// Pfad der Audiodatei in der Bibliothek.
    pub fn file_path(&self, track: &Track) -> PathBuf {
        self.music_dir.join(&track.file)
    }

    pub fn playlists(&self) -> anyhow::Result<Vec<Playlist>> {
        let db = self.db.lock();
        let mut stmt = db.prepare("SELECT id, name FROM playlists ORDER BY id")?;
        let mut playlists = stmt
            .query_map([], |r| {
                Ok(Playlist {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    track_ids: Vec::new(),
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        let mut stmt = db.prepare(
            "SELECT track_id FROM playlist_tracks WHERE playlist_id = ?1 ORDER BY position",
        )?;
        for playlist in &mut playlists {
            playlist.track_ids = stmt
                .query_map([playlist.id], |r| r.get(0))?
                .collect::<rusqlite::Result<Vec<_>>>()?;
        }
        Ok(playlists)
    }

    pub fn create_playlist(&self, name: &str) -> anyhow::Result<i64> {
        let db = self.db.lock();
        db.execute("INSERT INTO playlists (name) VALUES (?1)", [name.trim()])?;
        Ok(db.last_insert_rowid())
    }

    pub fn rename_playlist(&self, id: i64, name: &str) -> anyhow::Result<()> {
        self.db.lock().execute(
            "UPDATE playlists SET name = ?2 WHERE id = ?1",
            params![id, name.trim()],
        )?;
        Ok(())
    }

    pub fn delete_playlist(&self, id: i64) -> anyhow::Result<()> {
        self.db
            .lock()
            .execute("DELETE FROM playlists WHERE id = ?1", [id])?;
        Ok(())
    }

    /// Schreibt die Titelliste einer Playlist komplett neu (Hinzufügen,
    /// Entfernen und Umsortieren laufen alle hierüber).
    pub fn set_playlist_tracks(&self, id: i64, track_ids: &[i64]) -> anyhow::Result<()> {
        let mut db = self.db.lock();
        let tx = db.transaction()?;
        tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
        for (position, track_id) in track_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
                params![id, track_id, position as i64],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    fn remember(&self, id: i64, samples: Arc<[f32]>) {
        let mut cache = self.cache.lock();
        cache.retain(|(t, _)| *t != id);
        cache.push_back((id, samples));
        while cache.len() > CACHE_TRACKS {
            cache.pop_front();
        }
    }

    /// Dekodierter Titel, bei Bedarf von der Platte geladen.
    pub fn samples(&self, id: i64) -> anyhow::Result<Arc<[f32]>> {
        if let Some((_, samples)) = self.cache.lock().iter().find(|(t, _)| *t == id) {
            return Ok(samples.clone());
        }
        let track = self.track(id)?;
        let samples: Arc<[f32]> = decode_file(&self.music_dir.join(track.file))?.into();
        self.remember(id, samples.clone());
        Ok(samples)
    }
}

// ------------------------------------------------------------------ Player

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Repeat {
    #[default]
    Off,
    All,
    One,
}

#[derive(Default)]
struct PlayerState {
    queue: Vec<i64>,
    /// Abspielreihenfolge als Indizes in `queue`.
    order: Vec<usize>,
    index: usize,
    shuffle: bool,
    repeat: Repeat,
    current: Option<i64>,
    loading: bool,
    /// Soll laufen (auch während geladen wird).
    wants_play: bool,
    /// Zuletzt bekannte Position, für den Neustart der Engine.
    last_position: usize,
    error: Option<String>,
}

#[derive(Default)]
pub struct Player {
    state: Mutex<PlayerState>,
    /// Verwirft veraltete Ladevorgänge, wenn schnell weitergeschaltet wird.
    generation: AtomicU64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub track: Option<Track>,
    pub position_ms: u32,
    pub duration_ms: u32,
    pub playing: bool,
    pub loading: bool,
    pub shuffle: bool,
    pub repeat: Repeat,
    pub queue_length: usize,
    pub queue_index: usize,
    pub error: Option<String>,
    /// Eigene Lautstärke des Players, 0–1.
    pub volume: f32,
}

/// Einfacher Zufall ohne zusätzliche Abhängigkeit.
fn shuffled(len: usize, first: Option<usize>) -> Vec<usize> {
    let mut seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0x9E37_79B9_7F4A_7C15)
        | 1;
    let mut next = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        seed
    };
    let mut order: Vec<usize> = (0..len).filter(|&i| Some(i) != first).collect();
    for i in (1..order.len()).rev() {
        let j = (next() % (i as u64 + 1)) as usize;
        order.swap(i, j);
    }
    if let Some(first) = first.filter(|&f| f < len) {
        order.insert(0, first);
    }
    order
}

fn ms_to_samples(ms: u32) -> usize {
    ms as usize * ENGINE_RATE as usize / 1000
}

fn samples_to_ms(samples: usize) -> u32 {
    (samples as u64 * 1000 / ENGINE_RATE as u64) as u32
}

impl Player {
    fn current_track_id(state: &PlayerState) -> Option<i64> {
        state
            .order
            .get(state.index)
            .and_then(|&i| state.queue.get(i))
            .copied()
    }

    /// Lädt den aktuellen Titel im Hintergrund und startet ihn bei Bedarf.
    fn load_current<R: Runtime>(&self, app: &AppHandle<R>, play: bool, position: usize) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let track_id = {
            let mut state = self.state.lock();
            let id = Self::current_track_id(&state);
            state.current = id;
            state.loading = id.is_some();
            state.wants_play = play && id.is_some();
            state.last_position = position;
            state.error = None;
            id
        };
        let Some(track_id) = track_id else {
            let _ = app.state::<Engine>().deck(DeckCommand::Unload);
            return;
        };
        let app = app.clone();
        thread::spawn(move || {
            let result = app.state::<MusicLibrary>().samples(track_id);
            let player = app.state::<Player>();
            if player.generation.load(Ordering::SeqCst) != generation {
                return;
            }
            let mut state = player.state.lock();
            state.loading = false;
            match result {
                Ok(samples) => {
                    let engine = app.state::<Engine>();
                    let play = state.wants_play;
                    let sent = engine.deck(DeckCommand::Load {
                        track_id,
                        samples,
                        play: false,
                    });
                    if position > 0 {
                        let _ = engine.deck(DeckCommand::Seek(position));
                    }
                    if play {
                        let _ = engine.deck(DeckCommand::Play);
                    }
                    if let Err(e) = sent {
                        state.error = Some(e);
                    }
                }
                Err(e) => {
                    state.error = Some(crate::tr!(
                        "Titel konnte nicht geladen werden: {e}",
                        "Could not load track: {e}"
                    ))
                }
            }
        });
    }

    pub fn play_queue<R: Runtime>(&self, app: &AppHandle<R>, queue: Vec<i64>, start: usize) {
        {
            let mut state = self.state.lock();
            let start = start.min(queue.len().saturating_sub(1));
            state.order = if state.shuffle {
                shuffled(queue.len(), Some(start))
            } else {
                (0..queue.len()).collect()
            };
            state.index = if state.shuffle { 0 } else { start };
            state.queue = queue;
        }
        self.load_current(app, true, 0);
    }

    pub fn toggle<R: Runtime>(&self, app: &AppHandle<R>) {
        let engine = app.state::<Engine>();
        let status = engine.deck_status.lock().clone();
        let mut state = self.state.lock();
        if state.current.is_none() {
            return;
        }
        if state.loading {
            state.wants_play = !state.wants_play;
            return;
        }
        if status.track_id != state.current {
            // Engine wurde neu gestartet: Titel neu laden.
            let position = state.last_position;
            drop(state);
            self.load_current(app, true, position);
            return;
        }
        if status.playing {
            state.wants_play = false;
            let _ = engine.deck(DeckCommand::Pause);
        } else {
            state.wants_play = true;
            if status.finished || status.position >= status.length {
                let _ = engine.deck(DeckCommand::Seek(0));
            }
            let _ = engine.deck(DeckCommand::Play);
        }
    }

    /// Nächster Titel; `auto` = der vorige lief zu Ende.
    pub fn next<R: Runtime>(&self, app: &AppHandle<R>, auto: bool) {
        let mut state = self.state.lock();
        if state.queue.is_empty() {
            return;
        }
        if auto && state.repeat == Repeat::One {
            drop(state);
            let engine = app.state::<Engine>();
            let _ = engine.deck(DeckCommand::Seek(0));
            let _ = engine.deck(DeckCommand::Play);
            return;
        }
        if state.index + 1 < state.order.len() {
            state.index += 1;
        } else if state.repeat == Repeat::All || !auto {
            state.index = 0;
            if state.shuffle {
                state.order = shuffled(state.queue.len(), None);
            }
        } else {
            // Ende der Warteschlange: anhalten, Titel bleibt geladen.
            state.wants_play = false;
            return;
        }
        drop(state);
        self.load_current(app, true, 0);
    }

    pub fn previous<R: Runtime>(&self, app: &AppHandle<R>) {
        let position = app.state::<Engine>().deck_status.lock().position;
        let mut state = self.state.lock();
        if state.queue.is_empty() {
            return;
        }
        // Nach den ersten 3 s springt Zurück an den Anfang des Titels.
        if position > ms_to_samples(3000) {
            drop(state);
            let _ = app.state::<Engine>().deck(DeckCommand::Seek(0));
            return;
        }
        state.index = if state.index == 0 {
            state.order.len() - 1
        } else {
            state.index - 1
        };
        drop(state);
        self.load_current(app, true, 0);
    }

    pub fn seek<R: Runtime>(&self, app: &AppHandle<R>, ms: u32) {
        let _ = app
            .state::<Engine>()
            .deck(DeckCommand::Seek(ms_to_samples(ms)));
        self.state.lock().last_position = ms_to_samples(ms);
    }

    pub fn set_shuffle(&self, shuffle: bool) {
        let mut state = self.state.lock();
        if state.shuffle == shuffle {
            return;
        }
        state.shuffle = shuffle;
        let current = state.order.get(state.index).copied();
        state.order = if shuffle {
            shuffled(state.queue.len(), current)
        } else {
            (0..state.queue.len()).collect()
        };
        state.index = if shuffle { 0 } else { current.unwrap_or(0) };
    }

    pub fn set_repeat(&self, repeat: Repeat) {
        self.state.lock().repeat = repeat;
    }

    /// Nach einem Neustart der Engine den Titel wieder laden.
    pub fn resync<R: Runtime>(&self, app: &AppHandle<R>) {
        let (current, play, position) = {
            let state = self.state.lock();
            (state.current, state.wants_play, state.last_position)
        };
        if current.is_some() {
            self.load_current(app, play, position);
        }
    }

    pub fn snapshot<R: Runtime>(&self, app: &AppHandle<R>) -> PlayerSnapshot {
        let status = app.state::<Engine>().deck_status.lock().clone();
        let state = self.state.lock();
        let track = state
            .current
            .and_then(|id| app.state::<MusicLibrary>().track(id).ok());
        let on_deck = status.track_id.is_some() && status.track_id == state.current;
        PlayerSnapshot {
            position_ms: samples_to_ms(if on_deck {
                status.position
            } else {
                state.last_position
            }),
            duration_ms: track.as_ref().map_or(0, |t| t.duration_ms),
            playing: if on_deck {
                status.playing
            } else {
                state.wants_play
            },
            track,
            loading: state.loading,
            shuffle: state.shuffle,
            repeat: state.repeat,
            queue_length: state.queue.len(),
            queue_index: state.index,
            error: state.error.clone(),
            volume: app.state::<Engine>().mixer.player_volume.load(),
        }
    }

    /// Springt am Titelende weiter und merkt sich die Position.
    pub fn spawn_monitor<R: Runtime>(app: AppHandle<R>) {
        thread::Builder::new()
            .name("ode-player".into())
            .spawn(move || {
                let mut handled_end: Option<(i64, u64)> = None;
                loop {
                    thread::sleep(Duration::from_millis(100));
                    let status = app.state::<Engine>().deck_status.lock().clone();
                    let player = app.state::<Player>();
                    let generation = player.generation.load(Ordering::SeqCst);
                    let current = {
                        let mut state = player.state.lock();
                        if status.track_id.is_some() && status.track_id == state.current {
                            state.last_position = status.position;
                        }
                        state.current
                    };
                    if status.finished
                        && status.track_id.is_some()
                        && status.track_id == current
                        && handled_end != Some((status.track_id.unwrap_or(0), generation))
                    {
                        handled_end = Some((status.track_id.unwrap_or(0), generation));
                        player.next(&app, true);
                    }
                }
            })
            .expect("Player-Thread konnte nicht starten");
    }
}

// ---------------------------------------------------------------- Befehle

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicState {
    tracks: Vec<Track>,
    playlists: Vec<Playlist>,
}

#[tauri::command]
pub fn music_state(music: State<MusicLibrary>) -> Result<MusicState, String> {
    Ok(MusicState {
        tracks: music.tracks().map_err(err)?,
        playlists: music.playlists().map_err(err)?,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackImport {
    tracks: Vec<Track>,
    errors: Vec<String>,
}

#[tauri::command]
pub async fn music_import(
    music: State<'_, MusicLibrary>,
    tools: State<'_, crate::downloader::Tools>,
    paths: Vec<PathBuf>,
    playlist_id: Option<i64>,
) -> Result<TrackImport, String> {
    let mut tracks = Vec::new();
    let mut errors = Vec::new();
    // Eingebettete Cover mit FFmpeg zuschneiden, falls schon installiert.
    let meta = ImportMeta {
        ffmpeg: Some(tools.ffmpeg()),
        ..Default::default()
    };
    for path in paths {
        match music.import_with(&path, &meta) {
            Ok(track) => tracks.push(track),
            Err(e) => errors.push(format!(
                "{}: {e}",
                path.file_name().unwrap_or_default().to_string_lossy()
            )),
        }
    }
    if let Some(id) = playlist_id {
        let mut ids = music
            .playlists()
            .map_err(err)?
            .into_iter()
            .find(|p| p.id == id)
            .map(|p| p.track_ids)
            .unwrap_or_default();
        ids.extend(tracks.iter().map(|t| t.id));
        music.set_playlist_tracks(id, &ids).map_err(err)?;
    }
    Ok(TrackImport { tracks, errors })
}

#[tauri::command]
pub fn music_delete_track(music: State<MusicLibrary>, id: i64) -> Result<(), String> {
    music.delete_track(id).map_err(err)
}

#[tauri::command]
pub fn playlist_create(music: State<MusicLibrary>, name: String) -> Result<i64, String> {
    music.create_playlist(&name).map_err(err)
}

#[tauri::command]
pub fn playlist_rename(music: State<MusicLibrary>, id: i64, name: String) -> Result<(), String> {
    music.rename_playlist(id, &name).map_err(err)
}

#[tauri::command]
pub fn playlist_delete(music: State<MusicLibrary>, id: i64) -> Result<(), String> {
    music.delete_playlist(id).map_err(err)
}

#[tauri::command]
pub fn playlist_set_tracks(
    music: State<MusicLibrary>,
    id: i64,
    track_ids: Vec<i64>,
) -> Result<(), String> {
    music.set_playlist_tracks(id, &track_ids).map_err(err)
}

#[tauri::command]
pub fn player_play(app: AppHandle, queue: Vec<i64>, start: usize) {
    app.state::<Player>().play_queue(&app, queue, start);
}

#[tauri::command]
pub fn player_toggle(app: AppHandle) {
    app.state::<Player>().toggle(&app);
}

#[tauri::command]
pub fn player_next(app: AppHandle) {
    app.state::<Player>().next(&app, false);
}

#[tauri::command]
pub fn player_previous(app: AppHandle) {
    app.state::<Player>().previous(&app);
}

#[tauri::command]
pub fn player_seek(app: AppHandle, ms: u32) {
    app.state::<Player>().seek(&app, ms);
}

#[tauri::command]
pub fn player_set_shuffle(player: State<Player>, shuffle: bool) {
    player.set_shuffle(shuffle);
}

#[tauri::command]
pub fn player_set_repeat(player: State<Player>, repeat: Repeat) {
    player.set_repeat(repeat);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_artist_and_title() {
        assert_eq!(
            title_and_artist(Path::new("Daft Punk - One More Time.mp3")),
            ("One More Time".into(), Some("Daft Punk".into()))
        );
        assert_eq!(
            title_and_artist(Path::new("lofi_beat.wav")),
            ("lofi beat".into(), None)
        );
    }

    #[test]
    fn shuffle_keeps_first_and_all_items() {
        let order = shuffled(10, Some(4));
        assert_eq!(order[0], 4);
        let mut sorted = order.clone();
        sorted.sort();
        assert_eq!(sorted, (0..10).collect::<Vec<_>>());
    }

    #[test]
    fn playlists_round_trip() {
        let dir = std::env::temp_dir().join(format!("ode-music-test-{}", std::process::id()));
        let music = MusicLibrary::open(&dir).unwrap();
        let id = music.create_playlist("Chill").unwrap();
        music.set_playlist_tracks(id, &[]).unwrap();
        let playlists = music.playlists().unwrap();
        assert_eq!(playlists.len(), 1);
        assert_eq!(playlists[0].name, "Chill");
        music.delete_playlist(id).unwrap();
        assert!(music.playlists().unwrap().is_empty());
        drop(music);
        let _ = fs::remove_dir_all(&dir);
    }
}
