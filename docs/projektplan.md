# Soundboard-App – Projektplan

Oct 18, 2026 · @Moritz

## Überblick

Die App ist ein Windows-Soundboard mit eingebautem Mischpult: Sie nimmt das echte Mikrofon auf, verarbeitet und mischt es mit Sounds und Musik und gibt alles auf ein signiertes virtuelles Kabel aus. In Discord und Spielen wählt man einmalig dieses Kabel als Mikrofon.

- **Plattform:** Windows 10/11, 64-Bit, privater Gebrauch.
- **Treiber:** fertiger, von Microsoft signierter Treiber (VB-Cable oder Virtual Audio Cable Lite). Kein eigener Treiber, kein Testmodus, keine Konflikte mit Anti-Cheat.
- **Kernidee:** Alles außer dem Kabel steckt in der App: Downloader, Soundboard, Musik-Player, Mikrofon-Effekte und Mischpult.
- **Design:** Optik von T3 Code, Funktion eigenständig.

## Architektur

Die Rust-Audio-Engine ist das Herz der App: Alle Quellen laufen in ihr zusammen, und nur Ausgang B geht ins virtuelle Kabel, das Discord und Spiele als Mikrofon sehen.

&#91;embedded content: Signalfluss · 4 Quellen, 2 Ausgänge\]

Die Oberfläche (Tauri, React) steuert die Engine nur per Nachricht; Audio selbst läuft nie durch die Oberfläche. Gestrichelt = geplant, nicht in Version 1.

## Funktionen

Die App hat fünf Bereiche; Soundboard, Musik und Mischpult bilden den Kern der ersten Version.

### Soundboard

- Kacheln mit Name, Farbe, Hotkey und Lautstärke pro Sound.
- Kategorien, Favoriten und Suche.
- Globale Hotkeys, auch wenn ein Spiel im Vordergrund ist.
- Wiedergabemodi: Neustart, Überlagern oder Stopp beim erneuten Drücken.
- Trimmen mit Wellenform, Ein- und Ausblenden.
- Ducking: Sounds werden leiser, während du sprichst (optional).

### Musik

Musik ist ein eigener Kanal mit Player statt einzelner Kacheln.

- **Dateien (Version 1):** Playlists aus lokalen Dateien und Downloads, mit Play/Pause, Vor/Zurück, Suchleiste, Shuffle und Wiederholen.
- Eigener Lautstärkeregler, damit Musik leise unter der Stimme laufen kann.
- Wahlweise nur ins virtuelle Mikro, nur auf die Kopfhörer oder beides.
- **Live einschalten (Planung):** Audio einer anderen App direkt übernehmen, etwa Spotify oder ein Browser-Tab mit YouTube. Technisch über Windows' Pro-Prozess-Loopback (ab Windows 10 2004): Die App nimmt nur den Ton dieses einen Programms auf und legt ihn auf den Musik-Kanal. Das umgeht Download und Login und funktioniert mit jeder App.
- **Integrationen (Planung, später):** Spotify-Steuerung über die Web-API (Titelanzeige, Play/Pause, Skip); der Ton kommt weiterhin über den Loopback. Ein YouTube-Player in der App wäre eine Alternative, ist aber aufwendiger.

### Mischpult

- Kanäle: Mikrofon, Soundboard, Musik, später App-Quellen.
- Pro Kanal: Fader, Mute, Pegelanzeige und Routing auf zwei Ausgänge.
- **Ausgang A** = Kopfhörer (Mithören), **Ausgang B** = virtuelles Mikrofon.
- Master-Limiter auf Ausgang B, damit nichts übersteuert.

### Mikrofon-Effekte

Effektkette in fester Reihenfolge, jeder Effekt einzeln schaltbar:

1. Noise Gate
2. Rauschunterdrückung (RNNoise als Standard, DeepFilterNet als Qualitätsstufe)
3. Equalizer
4. Kompressor
5. Limiter

### Downloader

- Link einfügen (YouTube und andere von yt-dlp unterstützte Seiten), Ziel wählen: Soundboard oder Musik.
- FFmpeg wandelt in 48 kHz um und gleicht die Lautheit mit `loudnorm` an.
- Warteschlange mit Fortschritt; yt-dlp aktualisiert sich bei Bedarf selbst.

### Allgemein

- Einrichtungsassistent beim ersten Start: Treiber prüfen oder installieren, Mikrofon und Kopfhörer wählen.
- Läuft im Tray weiter, Autostart optional.
- Hell- und Dunkelmodus.

## Design

Die App übernimmt die Optik von [T3 Code](https://github.com/pingdotgg/t3code): ruhige Zink-Grautöne, ein einziges kräftiges Blau als Akzent, kompakte Abstände und dünne Rahmen. Die Werte unten stammen aus `apps/web/src/index.css` und `components.json` im Repo.

### Grundlage

- **UI-Bausteine:** shadcn/ui (Stil „base-mira“, Grundfarbe Zink) mit Tailwind CSS v4.
- **Icons:** Lucide.
- **Schrift:** Systemschrift (Segoe UI unter Windows), Monospace für Zahlen wie dB-Werte und Zeiten.
- **Radius:** 10 px als Basis (0.625rem), Bedienelemente 8 px.
- **Kleine Schriftgrößen:** 11 px und 10 px für Badges, Hotkey-Hinweise und Zähler.

### Farben

| Token | Hell | Dunkel |
| --- | --- | --- |
| Hintergrund | Zink 25 | Neutral 950 |
| Text | Zink 800 | Neutral 100 |
| Karten / Popover | Weiß | Hintergrund + 3 % Weiß |
| Akzent (Primary) | oklch(0.488 0.217 264) | oklch(0.571 0.21 264) |
| Gedämpfter Text | Zink 500 | Neutral 500, aufgehellt |
| Rahmen | Zink 200 | Weiß 6 % |
| Eingabefelder | Zink 300 | Weiß 8 % |
| Seitenleiste | Zink 50 | wie Karten |
| Erfolg / Warnung / Fehler | Emerald 500 / Amber 500 / Error-Token | dieselben, Text heller |

Die Pegelanzeigen nutzen Erfolg, Warnung und Fehler für Grün, Gelb und Rot.

### Layout

- **Seitenleiste links** wie die Projekt- und Thread-Liste in T3 Code: Bereiche (Soundboard, Musik, Mischpult, Effekte, Downloads), darunter Kategorien und Playlists.
- **Obere Leiste**, 52 px hoch, mit Titel, Suche und Statuspunkt für das virtuelle Kabel.
- **Hauptbereich** mit maximal etwa 46 rem Inhaltsbreite für Listen; das Kachelraster und das Mischpult nutzen die volle Breite.
- **Unten angedockt**, wie der Eingabebereich von T3 Code: die Musik-Leiste mit Titel, Fortschritt und Lautstärke, mit dem weichen T3-Schatten.
- **Befehlspalette** (Strg+K) zum schnellen Abspielen und Suchen, wie in T3 Code.
- Glas-Effekt (12–16 px Blur) nur für schwebende Elemente wie Popovers und Mini-Player.

## Technik-Stack

Tauri mit Rust-Backend und React-Oberfläche; so passt das T3-Design (React, Tailwind, shadcn) direkt, und die Audio-Engine läuft nativ in Rust.

| Bereich | Wahl | Zweck |
| --- | --- | --- |
| App-Rahmen | Tauri 2 | Fenster, Tray, Autostart, kleine Installationsgröße |
| Oberfläche | React, TypeScript, Tailwind v4, shadcn/ui, Lucide | Design wie T3 Code |
| Audio-Ein-/Ausgabe | `cpal` mit WASAPI | Mikrofon lesen, Kopfhörer und Kabel beschreiben |
| App-Loopback | `windows`-Crate, `AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS` | Ton einzelner Apps (Spotify, Browser) aufnehmen |
| Dekodieren | `symphonia` | MP3, Opus, FLAC, WAV, AAC lesen |
| Resampling | `rubato` | alles auf 48 kHz bringen |
| Rauschunterdrückung | `nnnoiseless` (RNNoise), DeepFilterNet | Noise Cancelling |
| Effekte | eigener DSP-Code oder `fundsp` | Gate, EQ, Kompressor, Limiter |
| Hotkeys | `global-hotkey` bzw. Tauri-Plugin | Tasten auch im Spiel |
| Bibliothek | SQLite (`rusqlite`) | Sounds, Playlists, Kategorien, Einstellungen |
| Downloader | yt-dlp und FFmpeg als mitgelieferte Programme | Download, Umwandlung, Lautheit |
| Treiber | VB-Cable (signiert, im Installer mitgeliefert) | virtuelles Mikrofon |

Die Audio-Engine läuft in einem eigenen Thread mit fester Blockgröße (10 ms bei 48 kHz = 480 Samples, passend zu RNNoise); die Oberfläche steuert sie nur über Nachrichten.

## Roadmap

Phase 1 entscheidet über das ganze Projekt: Erst wenn das Mikrofon mit unter 30 ms Verzögerung sauber im Kabel ankommt, lohnen sich die Funktionen darüber.

&#91;embedded content: Roadmap · 5 Phasen\]

Phasen 1 bis 4 ergeben Version 1; Phase 5 bleibt Planung.

## Risiken und offene Fragen

Das größte Risiko ist die Latenz der Kette Mikrofon → App → Kabel; sie muss früh in Phase 1 gemessen werden.

| Risiko | Folge | Gegenmaßnahme |
| --- | --- | --- |
| Latenz über 30 ms | Stimme hörbar verzögert | kleine Puffer, Engine-Thread mit hoher Priorität (MMCSS), früh messen |
| Kabel-Treiber knackst oder verschiebt sich | Aussetzer im Mikro | Drift-Ausgleich per Resampling, Puffer-Füllstand überwachen |
| Discord-Filter (Krisp, Rauschunterdrückung) schluckt Musik | Musik kommt verzerrt an | Hinweis im Assistenten: Discord-Filter aus, App filtert selbst |
| yt-dlp bricht nach YouTube-Änderungen | Downloads schlagen fehl | automatische Aktualisierung von yt-dlp |
| DeepFilterNet zu rechenintensiv | höhere CPU-Last | RNNoise als Standard, DeepFilterNet optional |
| App-Loopback ab Windows 10 2004 | auf alten Systemen keine Live-Quellen | Funktion dort ausblenden |

**Offene Fragen**

- [x] VB-Cable oder VAC Lite als Standard-Treiber? → **VB-Cable.** Darf laut VB-Audio als Donationware mit Herkunftsangabe im eigenen Installer (auch still) mitgeliefert werden; VAC Lite nicht frei weitergebbar.
- [ ] Soll die App das echte Mikrofon exklusiv belegen oder geteilt?
- [ ] Spotify-Steuerung über die Web-API nötig, oder reicht der Loopback?
- [ ] Sollen Sounds pro Spiel oder Profil getrennte Hotkeys haben?

## Messungen

**18.10.2026 – Phase 1, Mikrofon → VB-Cable** (fifine USB-Mikrofon, alles 48 kHz / f32, `cargo run --release --example latency`)

| Ode-Puffer | Verzögerung bis „CABLE Output“ | Aussetzer |
| --- | --- | --- |
| 5 ms | 117,2 ms | 1 |
| 10 ms | 115,5 ms | 0 |
| 20 ms | 128,9 ms | 0 |

Nach dem Umstellen von VB-Cable auf `Max Latency = 1536` (3 × 512) und einem Neustart änderte sich fast nichts: Die Kette lag weiter bei 113–139 ms. Eine Zerlegung mit `ODE_MODE=cable` (Rauschen direkt in CABLE Input, ganz ohne Mikrofon und ohne Ode) ergab:

| Strecke | nach Gerätezeit | nach Callback-Zeit |
| --- | --- | --- |
| Selbsttest (Mikrofon doppelt) | 0,0 ms | 0,0 ms |
| nur Kabel (CABLE Input → CABLE Output) | 55–60 ms | 97–104 ms |
| Mikrofon → Ode (10 ms) → Kabel | 118–119 ms | 113–115 ms |

Windows bedient beide Seiten in 10-ms-Blöcken. **Ode selbst trägt etwa 15 ms bei, das Kabel im geteilten Modus rund 100 ms.** Die Treibereinstellung „Max Latency“ ist nur eine Obergrenze und senkt diesen Wert nicht. Mit VB-Cable ist das 30-ms-Ziel für die ganze Kette so nicht zu erreichen; offen ist der Vergleich mit VAC Lite und der exklusive WASAPI-Modus auf der Schreibseite.
