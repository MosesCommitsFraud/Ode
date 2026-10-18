import { Download, LayoutGrid, Music, Wand2 } from "lucide-react";
import { EmptyState } from "~/components/ui/misc";

export function SoundboardView() {
  return (
    <EmptyState icon={<LayoutGrid />} title="Noch keine Sounds">
      Kacheln mit Hotkeys, Kategorien und Trimmen kommen in Phase 2. Bis dahin: Mikrofon im
      Mischpult einrichten und die Latenz prüfen.
    </EmptyState>
  );
}

export function MusicView() {
  return (
    <EmptyState icon={<Music />} title="Keine Playlists">
      Playlists aus lokalen Dateien und Downloads, mit eigenem Kanal im Mischpult.
    </EmptyState>
  );
}

export function EffectsView() {
  return (
    <EmptyState icon={<Wand2 />} title="Effektkette">
      Noise Gate, Rauschunterdrückung (RNNoise), Equalizer, Kompressor und Limiter – jeder Effekt
      einzeln schaltbar.
    </EmptyState>
  );
}

export function DownloadsView() {
  return (
    <EmptyState icon={<Download />} title="Keine Downloads">
      Link einfügen, Ziel wählen: Soundboard oder Musik. yt-dlp und FFmpeg erledigen den Rest.
    </EmptyState>
  );
}
