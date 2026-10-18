//! Prüft den Downloader ohne Oberfläche: installiert yt-dlp und FFmpeg in den
//! echten App-Datenordner (falls noch nicht da), lädt einen Link und
//! importiert ihn in eine Temp-Bibliothek.
//!
//! cargo run --example download -- [Link] [soundboard|music]

use std::sync::Arc;
use std::time::{Duration, Instant};

use ode_lib::downloader::{Downloads, Job, JobStatus, Target, Tools};
use ode_lib::library::Library;
use ode_lib::music::MusicLibrary;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let url = args
        .next()
        .unwrap_or_else(|| "https://www.youtube.com/watch?v=jNQXAC9IVRw".into());
    let target = match args.next().as_deref() {
        Some("soundboard") => Target::Soundboard,
        _ => Target::Music,
    };

    let app_dir = std::path::PathBuf::from(std::env::var("APPDATA")?).join("dev.ode.app");
    let temp = std::env::temp_dir().join("ode-download-test");
    let _ = std::fs::remove_dir_all(&temp);

    let tools = Arc::new(Tools::new(&app_dir)?);
    let library = Arc::new(Library::open(&temp)?);
    let music = Arc::new(MusicLibrary::open(&temp)?);
    let downloads = Arc::new(Downloads::new(&temp)?);
    let started = Instant::now();

    if !tools.ready() {
        let last = Arc::new(parking_lot::Mutex::new(String::new()));
        tools.on_change(move |status| {
            let line = format!(
                "{} {:.0} %",
                status.step.unwrap_or_default(),
                (status.progress * 10.0).floor() * 10.0
            );
            let mut last = last.lock();
            if *last != line {
                println!("[{:>5.1} s] {line}", started.elapsed().as_secs_f32());
                *last = line;
            }
        });
        tools.install();
        if let Some(error) = tools.status().error {
            anyhow::bail!(error);
        }
    }
    let status = tools.status();
    println!(
        "Werkzeuge: yt-dlp {}, FFmpeg {}",
        status.yt_dlp.unwrap_or_else(|| "fehlt".into()),
        if status.ffmpeg { "da" } else { "fehlt" }
    );

    let (done_tx, done_rx) = crossbeam_channel::unbounded::<Job>();
    let last = Arc::new(parking_lot::Mutex::new(String::new()));
    downloads.on_change(move |jobs| {
        let Some(job) = jobs.into_iter().next() else {
            return;
        };
        let line = format!(
            "{:?} {:.0} % {}",
            job.status,
            (job.progress * 4.0).floor() * 25.0,
            job.title.clone().unwrap_or_default()
        );
        let mut last = last.lock();
        if *last != line {
            println!("[{:>5.1} s] {line}", started.elapsed().as_secs_f32());
            *last = line;
        }
        if matches!(
            job.status,
            JobStatus::Done | JobStatus::Failed | JobStatus::Cancelled
        ) {
            let _ = done_tx.send(job);
        }
    });
    {
        let (downloads, tools, library, music) = (
            downloads.clone(),
            tools.clone(),
            library.clone(),
            music.clone(),
        );
        std::thread::spawn(move || downloads.run_worker(&tools, &library, &music));
    }
    downloads.add(url, target, None);
    let job = done_rx.recv_timeout(Duration::from_secs(300))?;
    if let Some(error) = job.error {
        anyhow::bail!("Fehlgeschlagen: {error}");
    }

    match target {
        Target::Music => {
            let track = music
                .tracks()?
                .into_iter()
                .next()
                .ok_or_else(|| anyhow::anyhow!("kein Titel importiert"))?;
            let samples = music.samples(track.id)?;
            let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
            println!(
                "Importiert als Musik: „{}“ von {:?}, {} ms, RMS {:.1} dBFS",
                track.title,
                track.artist,
                track.duration_ms,
                20.0 * rms.log10()
            );
        }
        Target::Soundboard => {
            let sound = library
                .list()?
                .into_iter()
                .next()
                .ok_or_else(|| anyhow::anyhow!("kein Sound importiert"))?;
            println!(
                "Importiert als Sound: „{}“, {} ms",
                sound.name, sound.duration_ms
            );
        }
    }
    println!("OK in {:.1} s", started.elapsed().as_secs_f32());
    Ok(())
}
