# Externe Plugins (VST3/CLAP) in Ode

Stand: 2026-10-20. Machbarkeit, Entscheidung und Prototyp.

## Ergebnis in einem Satz

Machbar, mit einer Einschränkung: Das Hosting läuft im Prototyp **im selben Prozess**, ein abstürzendes Plugin beendet deshalb Ode. Für den Alltag sollte es vor der Freigabe in einen eigenen Prozess wandern (siehe „Nächste Schritte“). Der Prototyp lädt **CLAP**-Plugins und ist hinter dem Cargo-Feature `plugins` versteckt; der normale Build bleibt unverändert.

## Formate und Lizenzen

| | CLAP | VST3 |
|---|---|---|
| Lizenz des SDK | MIT | MIT seit VST 3.8 (Steinberg, 29.10.2025); vorher GPLv3 oder proprietär |
| Rust-Bausteine | `clack-host` 0.2 + `clack-extensions` 0.2 (MIT/Apache, sichere Wrapper speziell zum Hosten) | `vst3` 0.3 (MIT/Apache): reine COM-Bindings, unsicher, keine Host-Hilfen |
| Aufwand Host | gering: Laden, Aktivieren, Parameter, Fenster sind fertig gekapselt | hoch: Modul-Laden, Factory, `IComponent`/`IAudioProcessor`/`IEditController`, Parameter-Queues, `IPlugView`, Verbindung Component↔Controller, alles von Hand |
| Verbreitung | wachsend (z. B. u-he, Surge XT, Airwindows) | Standard, fast jedes kommerzielle Plugin |

**Entscheidung:** zuerst CLAP. VST3 ist lizenzrechtlich inzwischen unproblematisch, technisch aber ein eigenes Projekt. Vorher prüfen, ob der Bedarf wirklich da ist, also welche Plugins du nutzen willst und ob es sie als CLAP gibt.

## Was der Prototyp kann

Starten mit Plugin-Unterstützung:

```bash
pnpm tauri dev --features plugins
```

- **Plugin-Slot in der Mikrofon-Kette** nach den Stimm-Effekten, vor dem Limiter (`src-tauri/src/audio/insert.rs`). Die Engine kennt nur die Schnittstelle `Insert`. Im Audio-Thread wird nie blockiert: Ist der Slot beim Tausch gesperrt, läuft der Block trocken durch.
- **Suchen** in den CLAP-Standardordnern (`%COMMONPROGRAMFILES%\CLAP`, `%LOCALAPPDATA%\Programs\Common\CLAP`, `CLAP_PATH`) oder **eine `.clap`-Datei wählen**.
- **Mono und Stereo:** Mono rein, je nach Haupt-Port des Plugins 1 oder 2 Kanäle, Mono wieder raus (Mittelwert). Andere Formate werden abgelehnt, ebenso Instrumente ohne Audio-Eingang.
- **Parameter als Drehregler** auf Effekte → Plugin, seitenweise. Änderungen gehen lock-frei als CLAP-Events in den Audio-Thread.
- **Plugin-Fenster:** eingebettet in ein eigenes Win32-Fenster; wenn das Plugin nur schwebende Fenster kann, als schwebendes Fenster.
- **Bypass**, angezeigte **Latenz** des Plugins und **Rechenzeit** pro Block.
- **Threads nach CLAP-Regeln:** Laden, Aktivieren, Parameter und Fenster laufen auf einem eigenen „Main-Thread“ (`ode-plugins`) mit Win32-Nachrichtenschleife; die Verarbeitung startet im Audio-Thread (`ensure_processing_started`).
- **Tests:** Ein kleines Gain-Plugin (gebaut mit `clack-plugin`) läuft ohne Datei durch denselben Host: Verarbeitung, Parameter-Event, Parameter zurücklesen, Entladen (`cargo test --features plugins`). Die CI prüft Clippy und Tests auch mit dem Feature.

## Bekannte Lücken des Prototyps

1. **Kein Absturzschutz.** Ein Plugin-Absturz oder eine Endlosschleife im Audio-Thread reißt Ode mit. Auch das Laden beim Suchen führt fremden Code aus.
2. **Nicht gespeichert.** Nach einem Neustart ist der Slot leer, Plugin-Zustand (`state`-Extension) wird nicht gesichert.
3. **Latenz nicht ausgeglichen.** Sie wird nur angezeigt. Für die Stimme ist das in Ordnung (es gibt nur einen Pfad), wichtig wird es erst bei parallelen Wegen.
4. **Stoppen auf dem falschen Thread.** Beim Entladen wird die Verarbeitung auf dem Plugin-Thread angehalten statt im Audio-Thread. Viele Plugins vertragen das, die Spezifikation verlangt es anders.
5. **Parameter aus dem Plugin-Fenster** werden nur über regelmäßiges Abfragen (1 s) übernommen, nicht über die Ausgabe-Events des Plugins.
6. **Ein Slot**, nur im Mikrofon-Pfad, keine Kette und keine Busse.
7. **Größenänderung des Plugin-Fensters** wird nicht unterstützt (`HostGui` ist nicht implementiert).
8. Mit echten Plugins **nicht getestet**, weil auf dem Entwicklungsrechner keine installiert sind. Erster Test: Airwindows Consolidated oder Surge XT Effects (beide frei, mit CLAP).

## Nächste Schritte (Empfehlung, in dieser Reihenfolge)

1. **Mit echten Plugins testen** (siehe oben), vor allem Fenster und Parameter.
2. **Eigener Prozess** `ode-plugin-host.exe`: Das Plugin läuft dort, Audio fließt über Shared Memory (Ringpuffer, 480-Sample-Blöcke) mit einem Event zum Anstoßen. Kosten: etwa ein Block (10 ms) zusätzliche Latenz. Stürzt der Prozess ab, schaltet Ode den Slot auf Bypass und meldet es, statt selbst zu sterben. Das Suchen läuft genauso in einem Wegwerf-Prozess (Bitwig arbeitet nach demselben Prinzip).
3. **Speichern:** Plugin-Pfad, ID, Bypass und `state` in den Mischpult-Einstellungen; beim Start erst nach erfolgreichem Test-Laden im Host-Prozess einsetzen.
4. **Mehrere Slots** und Slots auf den Effekt-Bussen.
5. **VST3** erst danach, als zweiter Loader im Host-Prozess.

## Quellen

- [Steinberg: VST 3.8 SDK unter MIT-Lizenz (Pressemitteilung, 29.10.2025)](https://ocl-steinberg-live.steinberg.net/_storage/asset/819254/storage/master/Pressemitteilung%20-%202025-10-29%20-%20VST%203.8%20-%20DE.pdf)
- [Sonicstate: VST 3 Now Available Under MIT License](https://sonicstate.com/news/2025/10/30/vst-3-now-available-under-mit-license)
- [clack-host auf docs.rs](https://docs.rs/crate/clack-host/latest)
- [vst3 auf docs.rs](https://docs.rs/crate/vst3/latest)
