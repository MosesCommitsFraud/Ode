import { Download } from "lucide-react";
import { EmptyState } from "~/components/ui/misc";

export { MusicView } from "./MusicView";

export { EffectsView } from "./EffectsView";

export function DownloadsView() {
  return (
    <EmptyState icon={<Download />} title="Keine Downloads">
      Link einfügen, Ziel wählen: Soundboard oder Musik. yt-dlp und FFmpeg erledigen den Rest.
    </EmptyState>
  );
}
