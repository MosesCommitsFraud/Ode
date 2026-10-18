import { Download, Wand2 } from "lucide-react";
import { EmptyState } from "~/components/ui/misc";

export { MusicView } from "./MusicView";

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
