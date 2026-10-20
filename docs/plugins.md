# Externe Plugins (VST3/CLAP) in Ode

Stand: 2026-10-20. Machbarkeit, Entscheidung und Prototyp.

## Ergebnis in einem Satz

Machbar. Der Prototyp lädt **CLAP**-Plugins in einen unsichtbaren Hilfsprozess, den Ode selbst startet. Stürzt ein Plugin ab oder hängt es, läuft Ode weiter und die Stimme geht trocken durch. Er ist hinter dem Cargo-Feature `plugins` versteckt; der normale Build bleibt unverändert.

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

- **Hilfsprozess:** Ode startet sich selbst ein zweites Mal als `ode.exe --plugin-host <name>`, ohne Fenster und ohne Konsole; eine zweite Programmdatei ist nicht nötig. Gesteuert wird er über stdin/stdout (eine JSON-Zeile je Anfrage und Antwort, `plugins/child.rs` und `plugins/remote.rs`). Endet Ode, endet er mit.
- **Audio über gemeinsamen Speicher** (`plugins/shm.rs`): Ode schreibt den Block, weckt den Hilfsprozess über ein Windows-Event und wartet auf das Ergebnis, synchron im selben Block. Gemessen (Release, Test-Plugin, 480 Samples): Hin- und Rückweg im Median 0,014 ms, 99 % unter 0,04 ms. Zusätzliche Latenz entsteht also praktisch keine. Antwortet der Hilfsprozess nicht binnen 4 ms, läuft der Block trocken durch.
- **Absturz und Hänger:** Ein Wächter-Thread prüft den Hilfsprozess alle 100 ms. Ist er beendet, oder kam etwa 1 s lang kein Block zurück (dann wird er beendet), leert Ode den Slot und zeigt die Meldung mit „Neu laden“. Die nächste Aktion startet einen frischen Hilfsprozess. Auch das Suchen lädt fremde Bibliotheken nur im Hilfsprozess.
- **Plugin-Slot in der Mikrofon-Kette** nach den Stimm-Effekten, vor dem Limiter (`src-tauri/src/audio/insert.rs`). Die Engine kennt nur die Schnittstelle `Insert`. Im Audio-Thread wird nie blockiert: Ist der Slot beim Tausch gesperrt, läuft der Block trocken durch.
- **Suchen** in den CLAP-Standardordnern (`%COMMONPROGRAMFILES%\CLAP`, `%LOCALAPPDATA%\Programs\Common\CLAP`, `CLAP_PATH`) oder **eine `.clap`-Datei wählen**.
- **Mono und Stereo:** Mono rein, je nach Haupt-Port des Plugins 1 oder 2 Kanäle, Mono wieder raus (Mittelwert). Andere Formate werden abgelehnt, ebenso Instrumente ohne Audio-Eingang.
- **Parameter als Drehregler** auf Effekte → Plugin, seitenweise. Änderungen gehen lock-frei als CLAP-Events in den Audio-Thread.
- **Plugin-Fenster:** eingebettet in ein eigenes Win32-Fenster; wenn das Plugin nur schwebende Fenster kann, als schwebendes Fenster.
- **Bypass**, angezeigte **Latenz** des Plugins und **Rechenzeit** pro Block.
- **Threads nach CLAP-Regeln:** Laden, Aktivieren, Parameter und Fenster laufen auf dem Haupt-Thread des Hilfsprozesses mit Win32-Nachrichtenschleife; die Verarbeitung startet in dessen Audio-Thread (höchste Priorität).
- **Tests:** Ein kleines Gain-Plugin (gebaut mit `clack-plugin`) ist eingebaut und unter dem Pfad `ode:test-gain` ladbar (nicht in der Suche). `tests/plugin_host.rs` startet damit den echten Hilfsprozess: Audio hin und zurück, Parameter, harter Absturz (Prozess wird beendet), trockenes Weiterlaufen, Neu laden, eine kaputte Datei. Dazu Unit-Tests für Host und gemeinsamen Speicher (`cargo test --features plugins`). Die CI prüft Clippy und Tests auch mit dem Feature.

## Bekannte Lücken des Prototyps

1. **Nicht gespeichert.** Nach einem Neustart ist der Slot leer, Plugin-Zustand (`state`-Extension) wird nicht gesichert.
2. **Latenz des Plugins nicht ausgeglichen.** Sie wird nur angezeigt. Für die Stimme ist das in Ordnung (es gibt nur einen Pfad), wichtig wird es erst bei parallelen Wegen.
3. **Stoppen auf dem falschen Thread.** Beim Entladen wird die Verarbeitung auf dem Haupt-Thread des Hilfsprozesses angehalten statt im Audio-Thread. Viele Plugins vertragen das, die Spezifikation verlangt es anders.
4. **Parameter aus dem Plugin-Fenster** werden nur über regelmäßiges Abfragen (1 s) übernommen, nicht über die Ausgabe-Events des Plugins.
5. **Ein Slot**, nur im Mikrofon-Pfad, keine Kette und keine Busse.
6. **Größenänderung des Plugin-Fensters** wird nicht unterstützt (`HostGui` ist nicht implementiert).
7. Mit echten Plugins **nicht getestet**, weil auf dem Entwicklungsrechner keine installiert sind. Erster Test: Airwindows Consolidated oder Surge XT Effects (beide frei, mit CLAP).

## Nächste Schritte (Empfehlung, in dieser Reihenfolge)

1. **Mit echten Plugins testen** (siehe oben), vor allem Fenster und Parameter.
2. **Speichern:** Plugin-Pfad, ID, Bypass und `state` in den Mischpult-Einstellungen; beim Start im Hilfsprozess laden und nur bei Erfolg einsetzen.
3. **Mehrere Slots** (eine Kette im selben Hilfsprozess) und Slots auf den Effekt-Bussen.
4. **VST3** erst danach, als zweiter Loader im Hilfsprozess.

## Quellen

- [Steinberg: VST 3.8 SDK unter MIT-Lizenz (Pressemitteilung, 29.10.2025)](https://ocl-steinberg-live.steinberg.net/_storage/asset/819254/storage/master/Pressemitteilung%20-%202025-10-29%20-%20VST%203.8%20-%20DE.pdf)
- [Sonicstate: VST 3 Now Available Under MIT License](https://sonicstate.com/news/2025/10/30/vst-3-now-available-under-mit-license)
- [clack-host auf docs.rs](https://docs.rs/crate/clack-host/latest)
- [vst3 auf docs.rs](https://docs.rs/crate/vst3/latest)
