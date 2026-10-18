//! Downloader: holt Audio per yt-dlp, wandelt es mit FFmpeg in 48 kHz mit
//! angeglichener Lautheit (loudnorm) und importiert es ins Soundboard oder in
//! die Musik. yt-dlp und FFmpeg lädt die App beim ersten Gebrauch selbst in
//! ihren Datenordner; yt-dlp aktualisiert sich bei Bedarf.

use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, SystemTime};

use crossbeam_channel::{Receiver, Sender, unbounded};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::library::Library;
use crate::music::MusicLibrary;

const YT_DLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
/// FFmpeg-Build für Windows von BtbN (verlinkt von ffmpeg.org), LGPL mit DLLs:
/// rund 80 MB und über GitHub schnell geladen.
const FFMPEG_URL: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip";
/// So alt darf yt-dlp werden, bevor vor einem Download nach Updates gesucht wird.
const UPDATE_AFTER: Duration = Duration::from_secs(3 * 24 * 3600);

/// Rückmeldung an die Oberfläche (in der App: Tauri-Event).
type Notify<T> = Box<dyn Fn(T) + Send + Sync>;

/// Startet Programme ohne aufblitzendes Konsolenfenster.
fn command(program: &Path) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

// ------------------------------------------------------------ Werkzeuge

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub yt_dlp: Option<String>,
    pub ffmpeg: bool,
    pub installing: bool,
    pub step: Option<String>,
    pub progress: f32,
    pub error: Option<String>,
}

pub struct Tools {
    dir: PathBuf,
    state: Mutex<ToolsStatus>,
    notify: Mutex<Option<Notify<ToolsStatus>>>,
}

impl Tools {
    pub fn new(data_dir: &Path) -> anyhow::Result<Self> {
        let dir = data_dir.join("tools");
        fs::create_dir_all(&dir)?;
        let tools = Self {
            dir,
            state: Mutex::new(ToolsStatus::default()),
            notify: Mutex::new(None),
        };
        tools.refresh();
        Ok(tools)
    }

    pub fn yt_dlp(&self) -> PathBuf {
        self.dir.join("yt-dlp.exe")
    }

    pub fn ffmpeg(&self) -> PathBuf {
        self.dir.join("ffmpeg.exe")
    }

    pub fn ready(&self) -> bool {
        self.yt_dlp().is_file() && self.ffmpeg().is_file()
    }

    fn version(&self) -> Option<String> {
        let out = command(&self.yt_dlp()).arg("--version").output().ok()?;
        out.status
            .success()
            .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    fn refresh(&self) {
        let version = self.yt_dlp().is_file().then(|| self.version()).flatten();
        let mut state = self.state.lock();
        state.yt_dlp = version;
        state.ffmpeg = self.ffmpeg().is_file();
    }

    pub fn status(&self) -> ToolsStatus {
        self.state.lock().clone()
    }

    pub fn on_change(&self, notify: impl Fn(ToolsStatus) + Send + Sync + 'static) {
        *self.notify.lock() = Some(Box::new(notify));
    }

    fn emit(&self) {
        if let Some(notify) = self.notify.lock().as_ref() {
            notify(self.status());
        }
    }

    fn set_step(&self, step: &str, progress: f32) {
        {
            let mut state = self.state.lock();
            state.step = Some(step.into());
            state.progress = progress;
        }
        self.emit();
    }

    /// Lädt eine Datei mit Fortschritt herunter.
    fn download(&self, url: &str, target: &Path, step: &str) -> anyhow::Result<()> {
        let mut response = ureq::get(url).call()?;
        let total = response.body().content_length().unwrap_or(0);
        let mut reader = response.body_mut().as_reader();
        let partial = target.with_extension("part");
        let mut file = File::create(&partial)?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        let mut last = 0u64;
        loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])?;
            done += n as u64;
            if total > 0 && done - last > total / 100 {
                last = done;
                self.set_step(step, done as f32 / total as f32);
            }
        }
        file.flush()?;
        drop(file);
        fs::rename(&partial, target)?;
        Ok(())
    }

    fn install_files(&self) -> anyhow::Result<()> {
        if !self.yt_dlp().is_file() {
            self.download(YT_DLP_URL, &self.yt_dlp(), "yt-dlp wird geladen")?;
        }
        if !self.ffmpeg().is_file() {
            let zip_path = self.dir.join("ffmpeg.zip");
            self.download(FFMPEG_URL, &zip_path, "FFmpeg wird geladen")?;
            self.set_step("FFmpeg wird entpackt", 1.0);
            let result = (|| -> anyhow::Result<()> {
                // ffmpeg.exe und die DLLs aus bin/ übernehmen, ffprobe/ffplay nicht.
                let mut archive = zip::ZipArchive::new(File::open(&zip_path)?)?;
                let mut found = false;
                for i in 0..archive.len() {
                    let mut entry = archive.by_index(i)?;
                    let name = entry.name()?.to_string();
                    let Some((_, file)) = name.rsplit_once("/bin/") else {
                        continue;
                    };
                    let wanted = file == "ffmpeg.exe" || file.ends_with(".dll");
                    if !wanted || file.contains('/') {
                        continue;
                    }
                    let target = self.dir.join(file);
                    let partial = target.with_extension("part");
                    std::io::copy(&mut entry, &mut File::create(&partial)?)?;
                    fs::rename(&partial, &target)?;
                    found |= file == "ffmpeg.exe";
                }
                anyhow::ensure!(found, "ffmpeg.exe nicht im Archiv");
                Ok(())
            })();
            let _ = fs::remove_file(&zip_path);
            result?;
        }
        Ok(())
    }

    /// Lädt fehlende Werkzeuge; blockiert, Fortschritt kommt über `on_change`.
    pub fn install(&self) {
        {
            let mut state = self.state.lock();
            if state.installing {
                return;
            }
            state.installing = true;
            state.error = None;
        }
        self.emit();
        let result = self.install_files();
        self.refresh();
        {
            let mut state = self.state.lock();
            state.installing = false;
            state.step = None;
            state.progress = 0.0;
            state.error = result
                .err()
                .map(|e| format!("Installation fehlgeschlagen: {e}"));
        }
        self.emit();
    }

    /// Sucht nach einem neuen yt-dlp, wenn die letzte Suche lange her ist.
    fn update_if_stale(&self, force: bool) -> bool {
        let marker = self.dir.join("yt-dlp.checked");
        let stale = force
            || fs::metadata(&marker)
                .and_then(|m| m.modified())
                .map(|t| SystemTime::now().duration_since(t).unwrap_or_default() > UPDATE_AFTER)
                .unwrap_or(true);
        if !stale {
            return false;
        }
        let updated = command(&self.yt_dlp())
            .arg("-U")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        let _ = fs::write(&marker, b"");
        self.refresh();
        updated
    }
}

// ------------------------------------------------------------ Aufträge

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Target {
    Soundboard,
    Music,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Info,
    Downloading,
    Converting,
    Importing,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub url: String,
    pub target: Target,
    pub playlist_id: Option<i64>,
    pub status: JobStatus,
    pub progress: f32,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub error: Option<String>,
}

pub struct Downloads {
    jobs: Mutex<Vec<Job>>,
    next_id: AtomicU64,
    queue: Sender<u64>,
    receiver: Mutex<Option<Receiver<u64>>>,
    /// Laufender Prozess des aktuellen Auftrags, zum Abbrechen.
    child: Mutex<Option<(u64, Child)>>,
    work_dir: PathBuf,
    notify_jobs: Mutex<Option<Notify<Vec<Job>>>>,
    notify_imported: Mutex<Option<Notify<Target>>>,
}

#[derive(Debug)]
struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("abgebrochen")
    }
}

impl std::error::Error for Cancelled {}

/// Erlaubte Zeichen für Dateinamen unter Windows.
fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if "<>:\"/\\|?*".contains(c) || c.is_control() {
                ' '
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let short: String = trimmed.chars().take(120).collect();
    if short.is_empty() {
        "Download".into()
    } else {
        short
    }
}

/// "  42.3%" → 0.423
fn parse_percent(line: &str) -> Option<f32> {
    let value = line.trim().trim_end_matches('%').trim();
    value
        .parse::<f32>()
        .ok()
        .map(|p| (p / 100.0).clamp(0.0, 1.0))
}

impl Downloads {
    pub fn new(data_dir: &Path) -> anyhow::Result<Self> {
        let work_dir = data_dir.join("downloads");
        // Reste abgebrochener Läufe entfernen.
        let _ = fs::remove_dir_all(&work_dir);
        fs::create_dir_all(&work_dir)?;
        let (queue, receiver) = unbounded();
        Ok(Self {
            jobs: Mutex::new(Vec::new()),
            next_id: AtomicU64::new(1),
            queue,
            receiver: Mutex::new(Some(receiver)),
            child: Mutex::new(None),
            work_dir,
            notify_jobs: Mutex::new(None),
            notify_imported: Mutex::new(None),
        })
    }

    pub fn jobs(&self) -> Vec<Job> {
        self.jobs.lock().clone()
    }

    pub fn on_change(&self, notify: impl Fn(Vec<Job>) + Send + Sync + 'static) {
        *self.notify_jobs.lock() = Some(Box::new(notify));
    }

    /// Nach jedem Import, damit die Oberfläche die Bibliothek neu lädt.
    pub fn on_imported(&self, notify: impl Fn(Target) + Send + Sync + 'static) {
        *self.notify_imported.lock() = Some(Box::new(notify));
    }

    fn emit(&self) {
        if let Some(notify) = self.notify_jobs.lock().as_ref() {
            notify(self.jobs());
        }
    }

    fn update(&self, id: u64, change: impl FnOnce(&mut Job)) {
        if let Some(job) = self.jobs.lock().iter_mut().find(|j| j.id == id) {
            change(job);
        }
        self.emit();
    }

    fn is_cancelled(&self, id: u64) -> bool {
        self.jobs
            .lock()
            .iter()
            .any(|j| j.id == id && j.status == JobStatus::Cancelled)
    }

    pub fn add(&self, url: String, target: Target, playlist_id: Option<i64>) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.jobs.lock().push(Job {
            id,
            url,
            target,
            playlist_id,
            status: JobStatus::Queued,
            progress: 0.0,
            title: None,
            artist: None,
            error: None,
        });
        let _ = self.queue.send(id);
        self.emit();
        id
    }

    pub fn cancel(&self, id: u64) {
        self.update(id, |job| {
            if !matches!(job.status, JobStatus::Done | JobStatus::Failed) {
                job.status = JobStatus::Cancelled;
            }
        });
        let mut child = self.child.lock();
        if let Some((running, process)) = child.as_mut()
            && *running == id
        {
            let _ = process.kill();
        }
    }

    pub fn clear_finished(&self) {
        self.jobs.lock().retain(|j| {
            !matches!(
                j.status,
                JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled
            )
        });
        self.emit();
    }

    /// Startet einen Prozess, liest seine Ausgabe zeilenweise und wartet auf das Ende.
    fn run(
        &self,
        id: u64,
        mut cmd: Command,
        mut on_line: impl FnMut(&str),
    ) -> anyhow::Result<String> {
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut process = cmd.spawn()?;
        let stdout = process.stdout.take();
        let stderr = process.stderr.take();
        *self.child.lock() = Some((id, process));

        let errors = thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut stderr) = stderr {
                let _ = stderr.read_to_string(&mut text);
            }
            text
        });
        if let Some(stdout) = stdout {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                on_line(&line);
            }
        }
        let status = {
            let mut child = self.child.lock();
            let status = child.as_mut().map(|(_, p)| p.wait());
            *child = None;
            status
        };
        let stderr = errors.join().unwrap_or_default();
        if self.is_cancelled(id) {
            return Err(Cancelled.into());
        }
        match status {
            Some(Ok(s)) if s.success() => Ok(stderr),
            _ => {
                let message = stderr
                    .lines()
                    .rev()
                    .find(|l| l.contains("ERROR") || !l.trim().is_empty())
                    .unwrap_or("unbekannter Fehler")
                    .trim()
                    .trim_start_matches("ERROR:")
                    .trim()
                    .to_string();
                anyhow::bail!(message)
            }
        }
    }

    fn fetch(&self, tools: &Tools, job: &Job, dir: &Path) -> anyhow::Result<(PathBuf, f64)> {
        // 1. Infos: Titel, Kanal, Dauer.
        self.update(job.id, |j| j.status = JobStatus::Info);
        let mut json = String::new();
        let mut cmd = command(&tools.yt_dlp());
        cmd.args(["-J", "--no-playlist", "--no-warnings", &job.url]);
        self.run(job.id, cmd, |line| json.push_str(line))?;
        let info: serde_json::Value = serde_json::from_str(&json)?;
        let text = |key: &str| info.get(key).and_then(|v| v.as_str()).map(str::to_string);
        let title = text("track")
            .or_else(|| text("title"))
            .unwrap_or_else(|| "Download".into());
        let artist = text("artist")
            .or_else(|| text("creator"))
            .or_else(|| text("uploader"))
            .or_else(|| text("channel"));
        let duration = info.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0);
        self.update(job.id, |j| {
            j.title = Some(title.clone());
            j.artist = artist.clone();
            j.status = JobStatus::Downloading;
        });

        // 2. Bester Audio-Stream.
        let mut cmd = command(&tools.yt_dlp());
        cmd.args([
            "-f",
            "bestaudio/best",
            "--no-playlist",
            "--no-warnings",
            "--newline",
            "--progress-template",
            "download:ODE %(progress._percent_str)s",
            "-o",
        ])
        .arg(dir.join("source.%(ext)s"))
        .arg(&job.url);
        self.run(job.id, cmd, |line| {
            if let Some(p) = line.strip_prefix("ODE").and_then(parse_percent) {
                self.update(job.id, |j| j.progress = p);
            }
        })?;
        let source = fs::read_dir(dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .find(|p| {
                p.file_stem().is_some_and(|s| s == "source")
                    && p.extension().is_some_and(|e| e != "part")
            })
            .ok_or_else(|| anyhow::anyhow!("Download lieferte keine Datei"))?;
        Ok((source, duration))
    }

    fn process(
        &self,
        id: u64,
        tools: &Tools,
        library: &Library,
        music: &MusicLibrary,
    ) -> anyhow::Result<()> {
        let Some(job) = self.jobs.lock().iter().find(|j| j.id == id).cloned() else {
            return Ok(());
        };
        if job.status == JobStatus::Cancelled {
            return Ok(());
        }
        anyhow::ensure!(
            tools.ready(),
            "yt-dlp und FFmpeg fehlen – bitte zuerst installieren"
        );
        tools.update_if_stale(false);

        let dir = self.work_dir.join(id.to_string());
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir)?;

        // Schlägt yt-dlp fehl, einmal aktualisieren und neu versuchen
        // (YouTube ändert öfter etwas).
        let fetched = match self.fetch(tools, &job, &dir) {
            Err(e) if !e.is::<Cancelled>() && tools.update_if_stale(true) => {
                self.update(id, |j| j.progress = 0.0);
                self.fetch(tools, &job, &dir)
            }
            other => other,
        };
        let (source, duration) = fetched?;

        // 3. FFmpeg: 48 kHz, Lautheit angleichen, verlustfrei als FLAC.
        self.update(id, |j| {
            j.status = JobStatus::Converting;
            j.progress = 0.0;
        });
        let (title, artist) = {
            let jobs = self.jobs.lock();
            let j = jobs.iter().find(|j| j.id == id);
            (
                j.and_then(|j| j.title.clone())
                    .unwrap_or_else(|| "Download".into()),
                j.and_then(|j| j.artist.clone()),
            )
        };
        let name = match (job.target, &artist) {
            (Target::Music, Some(artist)) => safe_name(&format!("{artist} - {title}")),
            _ => safe_name(&title),
        };
        let output = dir.join(format!("{name}.flac"));
        let mut cmd = command(&tools.ffmpeg());
        cmd.args(["-hide_banner", "-nostats", "-y", "-i"])
            .arg(&source)
            .args([
                "-vn",
                "-af",
                "loudnorm=I=-16:TP=-1.5:LRA=11",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-c:a",
                "flac",
                "-progress",
                "pipe:1",
            ])
            .arg(&output);
        self.run(id, cmd, |line| {
            if let Some(us) = line
                .strip_prefix("out_time_us=")
                .and_then(|v| v.parse::<f64>().ok())
                && duration > 0.0
            {
                let p = (us / 1e6 / duration).clamp(0.0, 1.0) as f32;
                self.update(id, |j| j.progress = p);
            }
        })?;

        // 4. In die Bibliothek.
        self.update(id, |j| {
            j.status = JobStatus::Importing;
            j.progress = 1.0;
        });
        match job.target {
            Target::Soundboard => {
                library.import(&output)?;
            }
            Target::Music => {
                let track = music.import(&output)?;
                if let Some(playlist) = job.playlist_id {
                    let mut ids = music
                        .playlists()?
                        .into_iter()
                        .find(|p| p.id == playlist)
                        .map(|p| p.track_ids)
                        .unwrap_or_default();
                    ids.push(track.id);
                    music.set_playlist_tracks(playlist, &ids)?;
                }
            }
        }
        let _ = fs::remove_dir_all(&dir);
        if let Some(notify) = self.notify_imported.lock().as_ref() {
            notify(job.target);
        }
        Ok(())
    }

    /// Arbeitet die Warteschlange ab; blockiert, gehört in einen eigenen Thread.
    pub fn run_worker(&self, tools: &Tools, library: &Library, music: &MusicLibrary) {
        let Some(receiver) = self.receiver.lock().take() else {
            return;
        };
        for id in receiver {
            let result = self.process(id, tools, library, music);
            let _ = fs::remove_dir_all(self.work_dir.join(id.to_string()));
            self.update(id, |job| match result {
                Ok(()) if job.status != JobStatus::Cancelled => {
                    job.status = JobStatus::Done;
                    job.progress = 1.0;
                }
                Ok(()) => {}
                Err(e) if e.is::<Cancelled>() => job.status = JobStatus::Cancelled,
                Err(e) => {
                    job.status = JobStatus::Failed;
                    job.error = Some(e.to_string());
                }
            });
        }
    }
}

/// Verbindet Werkzeuge und Warteschlange mit Tauri-Events und startet den Worker.
pub fn start(app: &AppHandle) {
    let emitter = app.clone();
    app.state::<Tools>().on_change(move |status| {
        let _ = emitter.emit("tools://status", status);
    });
    let emitter = app.clone();
    app.state::<Downloads>().on_change(move |jobs| {
        let _ = emitter.emit("downloads://jobs", jobs);
    });
    let emitter = app.clone();
    app.state::<Downloads>().on_imported(move |target| {
        let _ = emitter.emit("library://changed", target);
    });
    let app = app.clone();
    thread::Builder::new()
        .name("ode-downloads".into())
        .spawn(move || {
            app.state::<Downloads>().run_worker(
                &app.state::<Tools>(),
                &app.state::<Library>(),
                &app.state::<MusicLibrary>(),
            )
        })
        .expect("Download-Thread konnte nicht starten");
}

// ---------------------------------------------------------------- Befehle

#[tauri::command]
pub fn tools_status(tools: State<Tools>) -> ToolsStatus {
    tools.status()
}

#[tauri::command]
pub fn tools_install(app: AppHandle) {
    thread::spawn(move || app.state::<Tools>().install());
}

#[tauri::command]
pub fn downloads_list(downloads: State<Downloads>) -> Vec<Job> {
    downloads.jobs()
}

#[tauri::command]
pub fn download_add(
    downloads: State<Downloads>,
    url: String,
    target: Target,
    playlist_id: Option<i64>,
) -> Result<u64, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("Bitte einen vollständigen Link (https://…) einfügen".into());
    }
    Ok(downloads.add(url, target, playlist_id))
}

#[tauri::command]
pub fn download_cancel(downloads: State<Downloads>, id: u64) {
    downloads.cancel(id);
}

#[tauri::command]
pub fn downloads_clear(downloads: State<Downloads>) {
    downloads.clear_finished();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_names() {
        assert_eq!(safe_name("AC/DC: Back in Black?"), "AC DC Back in Black");
        assert_eq!(safe_name("  "), "Download");
    }

    #[test]
    fn percent_lines() {
        assert_eq!(parse_percent("  42.0%"), Some(0.42));
        assert_eq!(parse_percent("100%"), Some(1.0));
        assert_eq!(parse_percent("NA"), None);
    }
}
