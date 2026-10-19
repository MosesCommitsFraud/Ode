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

use crate::covers::{self, ImportMeta};
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

/// Lädt eine Datei mit Fortschritt (0–1) herunter; erst fertig, dann umbenannt.
pub(crate) fn download_file(
    url: &str,
    target: &Path,
    progress: impl Fn(f32),
) -> anyhow::Result<()> {
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
            progress(done as f32 / total as f32);
        }
    }
    file.flush()?;
    drop(file);
    fs::rename(&partial, target)?;
    Ok(())
}

pub(crate) fn hidden_command(program: &Path) -> Command {
    command(program)
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
        download_file(url, target, |p| self.set_step(step, p))
    }

    fn install_files(&self) -> anyhow::Result<()> {
        if !self.yt_dlp().is_file() {
            self.download(
                YT_DLP_URL,
                &self.yt_dlp(),
                &crate::tr!("yt-dlp wird geladen", "Downloading yt-dlp"),
            )?;
        }
        if !self.ffmpeg().is_file() {
            let zip_path = self.dir.join("ffmpeg.zip");
            self.download(
                FFMPEG_URL,
                &zip_path,
                &crate::tr!("FFmpeg wird geladen", "Downloading FFmpeg"),
            )?;
            self.set_step(&crate::tr!("FFmpeg wird entpackt", "Unpacking FFmpeg"), 1.0);
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
            state.error = result.err().map(|e| {
                crate::tr!(
                    "Installation fehlgeschlagen: {e}",
                    "Installation failed: {e}"
                )
            });
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
    /// Soundboard und Musik gleichzeitig.
    Both,
}

impl Target {
    pub fn soundboard(self) -> bool {
        matches!(self, Target::Soundboard | Target::Both)
    }

    pub fn music(self) -> bool {
        matches!(self, Target::Music | Target::Both)
    }
}

/// Unter diesem Schlüssel liegen erledigte Aufträge, damit das Ziel auch nach
/// einem Neustart noch umgeschaltet werden kann.
const JOBS_KEY: &str = "downloads";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: u64,
    pub url: String,
    pub target: Target,
    pub status: JobStatus,
    pub progress: f32,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub error: Option<String>,
    /// Absoluter Pfad zum Cover (Kopie der Bibliothek).
    pub cover: Option<String>,
    /// Ergebnis im Soundboard bzw. in der Musik.
    pub sound_id: Option<i64>,
    pub track_id: Option<i64>,
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

    pub fn add(&self, url: String, target: Target) -> u64 {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.jobs.lock().push(Job {
            id,
            url,
            target,
            status: JobStatus::Queued,
            progress: 0.0,
            title: None,
            artist: None,
            error: None,
            cover: None,
            sound_id: None,
            track_id: None,
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
        // Hinweis: gespeichert wird beim nächsten Auftrag oder Umschalten.
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
            "--write-thumbnail",
            "-o",
        ])
        .arg(dir.join("source.%(ext)s"))
        .arg(&job.url);
        self.run(job.id, cmd, |line| {
            if let Some(p) = line.strip_prefix("ODE").and_then(parse_percent) {
                self.update(job.id, |j| j.progress = p);
            }
        })?;
        let files: Vec<PathBuf> = fs::read_dir(dir)?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.file_stem().is_some_and(|s| s == "source"))
            .collect();
        let is_image = |p: &PathBuf| {
            p.extension().and_then(|e| e.to_str()).is_some_and(|e| {
                matches!(e.to_lowercase().as_str(), "jpg" | "jpeg" | "png" | "webp")
            })
        };
        let source = files
            .iter()
            .find(|p| !is_image(p) && p.extension().is_some_and(|e| e != "part"))
            .cloned()
            .ok_or_else(|| {
                anyhow::anyhow!(crate::tr!(
                    "Download lieferte keine Datei",
                    "Download produced no file"
                ))
            })?;
        // Vorschaubild quadratisch als Cover.
        if let Some(thumbnail) = files.iter().find(|p| is_image(p)) {
            let _ = covers::square(&tools.ffmpeg(), thumbnail, &dir.join("cover.jpg"));
        }
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
            crate::tr!(
                "yt-dlp und FFmpeg fehlen – bitte zuerst installieren",
                "yt-dlp and FFmpeg are missing – please install them first"
            )
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
        let output = dir.join(format!("{}.flac", safe_name(&title)));
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
        let cover = dir.join("cover.jpg");
        let meta = ImportMeta {
            name: Some(title.clone()),
            artist: artist.clone(),
            cover: cover.is_file().then_some(cover),
            ffmpeg: Some(tools.ffmpeg()),
        };
        let mut sound_id = None;
        let mut track_id = None;
        let mut saved_cover = None;
        if job.target.soundboard() {
            let sound = library.import_with(&output, &meta)?;
            saved_cover = sound.cover.clone();
            sound_id = Some(sound.id);
        }
        if job.target.music() {
            let track = music.import_with(&output, &meta)?;
            saved_cover = saved_cover.or(track.cover.clone());
            track_id = Some(track.id);
        }
        self.update(id, |j| {
            j.sound_id = sound_id;
            j.track_id = track_id;
            j.cover = saved_cover;
        });
        let _ = fs::remove_dir_all(&dir);
        if let Some(notify) = self.notify_imported.lock().as_ref() {
            notify(job.target);
        }
        Ok(())
    }

    /// Erledigte Aufträge speichern.
    fn save(&self, library: &Library) {
        let done: Vec<Job> = self
            .jobs()
            .into_iter()
            .filter(|j| j.status == JobStatus::Done)
            .collect();
        if let Ok(json) = serde_json::to_string(&done) {
            let _ = library.set_setting(JOBS_KEY, &json);
        }
    }

    /// Gespeicherte, erledigte Aufträge beim Start wieder laden.
    pub fn restore(&self, library: &Library) {
        let saved: Vec<Job> = library
            .setting(JOBS_KEY)
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        let next = saved.iter().map(|j| j.id + 1).max().unwrap_or(1);
        self.next_id.fetch_max(next, Ordering::Relaxed);
        *self.jobs.lock() = saved;
        self.emit();
    }

    /// Ziel eines fertigen Downloads ändern: in die andere Bibliothek
    /// übernehmen bzw. dort entfernen.
    pub fn set_target(
        &self,
        id: u64,
        target: Target,
        library: &Library,
        music: &MusicLibrary,
    ) -> anyhow::Result<()> {
        let job = self
            .jobs()
            .into_iter()
            .find(|j| j.id == id)
            .ok_or_else(|| {
                anyhow::anyhow!(crate::tr!("Download nicht gefunden", "Download not found"))
            })?;
        anyhow::ensure!(
            job.status == JobStatus::Done,
            crate::tr!(
                "Download ist noch nicht fertig",
                "Download is not finished yet"
            )
        );

        // Quelle für eine neue Kopie: die vorhandene Datei in einer der Bibliotheken.
        let sound = job.sound_id.and_then(|id| library.get(id).ok());
        let track = job.track_id.and_then(|id| music.track(id).ok());
        let source = sound
            .as_ref()
            .map(|s| library.file_path(s))
            .or_else(|| track.as_ref().map(|t| music.file_path(t)))
            .ok_or_else(|| {
                anyhow::anyhow!(crate::tr!(
                    "Datei ist nicht mehr in der Bibliothek",
                    "File is no longer in the library"
                ))
            })?;
        let meta = ImportMeta {
            name: job.title.clone(),
            artist: job.artist.clone(),
            cover: job
                .cover
                .as_ref()
                .map(PathBuf::from)
                .filter(|p| p.is_file()),
            ffmpeg: None,
        };

        let mut sound_id = sound.as_ref().map(|s| s.id);
        let mut track_id = track.as_ref().map(|t| t.id);
        if target.soundboard() && sound_id.is_none() {
            sound_id = Some(library.import_with(&source, &meta)?.id);
        }
        if target.music() && track_id.is_none() {
            track_id = Some(music.import_with(&source, &meta)?.id);
        }
        if !target.soundboard()
            && let Some(id) = sound_id.take()
        {
            library.delete(id)?;
        }
        if !target.music()
            && let Some(id) = track_id.take()
        {
            music.delete_track(id)?;
        }
        let cover = sound_id
            .and_then(|id| library.get(id).ok())
            .and_then(|s| s.cover)
            .or_else(|| {
                track_id
                    .and_then(|id| music.track(id).ok())
                    .and_then(|t| t.cover)
            });
        self.update(id, |j| {
            j.target = target;
            j.sound_id = sound_id;
            j.track_id = track_id;
            j.cover = cover;
        });
        self.save(library);
        if let Some(notify) = self.notify_imported.lock().as_ref() {
            notify(Target::Both);
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
            self.save(library);
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
    app.state::<Downloads>().restore(&app.state::<Library>());
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
) -> Result<u64, String> {
    let url = url.trim().to_string();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(crate::tr!(
            "Bitte einen vollständigen Link (https://…) einfügen",
            "Please paste a complete link (https://…)"
        ));
    }
    Ok(downloads.add(url, target))
}

#[tauri::command]
pub fn download_set_target(app: AppHandle, id: u64, target: Target) -> Result<(), String> {
    app.state::<Downloads>()
        .set_target(
            id,
            target,
            &app.state::<Library>(),
            &app.state::<MusicLibrary>(),
        )
        .map_err(|e| e.to_string())
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
