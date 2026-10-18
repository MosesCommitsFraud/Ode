import { useEffect, useState } from "react";
import { MusicBar } from "~/components/shell/MusicBar";
import { Sidebar, VIEWS, type View } from "~/components/shell/Sidebar";
import { TopBar } from "~/components/shell/TopBar";
import { actions } from "~/lib/store";
import { MixerView } from "~/views/MixerView";
import { DownloadsView, EffectsView, MusicView } from "~/views/Placeholders";
import { SoundboardView } from "~/views/SoundboardView";

const SUBTITLES: Record<View, string> = {
  soundboard: "Sounds auf Knopfdruck ins Mikrofon",
  music: "Playlists für den Musikkanal",
  mixer: "Pegel, Wege und Geräte",
  effects: "Die Kette für deine Stimme",
  downloads: "Links rein, Sounds raus",
};

const THEME_KEY = "ode.theme";
const VIEW_KEY = "ode.view";

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Nur Komfort – ohne Speicher gilt die Auswahl für diese Sitzung.
  }
}

function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = readStorage(THEME_KEY);
    return stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  const toggle = () =>
    setDark((d) => {
      writeStorage(THEME_KEY, d ? "light" : "dark");
      return !d;
    });
  return { dark, toggle };
}

export default function App() {
  const { dark, toggle } = useTheme();
  const [view, setView] = useState<View>(() => {
    const stored = readStorage(VIEW_KEY);
    return VIEWS.some((v) => v.id === stored) ? (stored as View) : "mixer";
  });

  useEffect(() => {
    void actions.init();
  }, []);

  const changeView = (next: View) => {
    setView(next);
    writeStorage(VIEW_KEY, next);
  };

  const title = VIEWS.find((v) => v.id === view)?.label ?? "";
  const subtitle = SUBTITLES[view];

  return (
    <div className="grain relative isolate flex h-full">
      <Sidebar view={view} onView={changeView} dark={dark} onToggleTheme={toggle} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} subtitle={subtitle} />
        <div className="min-h-0 flex-1">
          {view === "soundboard" && <SoundboardView />}
          {view === "music" && <MusicView />}
          {view === "mixer" && <MixerView />}
          {view === "effects" && <EffectsView />}
          {view === "downloads" && <DownloadsView />}
        </div>
        <MusicBar />
      </main>
    </div>
  );
}
