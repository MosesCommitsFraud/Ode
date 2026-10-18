# Ode

Windows-Soundboard mit eingebautem Mischpult. Ode nimmt das echte Mikrofon auf, verarbeitet und mischt es mit Sounds und Musik und gibt alles auf ein signiertes virtuelles Kabel (VB-Cable oder VAC Lite) aus. In Discord und Spielen wählt man einmalig dieses Kabel als Mikrofon.

- **Oberfläche:** Tauri 2, React, TypeScript, Tailwind CSS v4, Lucide – Optik nach [T3 Code](https://github.com/pingdotgg/t3code)
- **Audio-Engine:** Rust (`cpal` mit WASAPI), eigener Thread, 10-ms-Blöcke bei 48 kHz

Projektplan: [docs/projektplan.md](docs/projektplan.md)

## Entwicklung

Voraussetzungen: Rust (MSVC-Toolchain), Node 22+, pnpm, ein virtuelles Audiokabel.

```bash
pnpm install
pnpm tauri dev
```
