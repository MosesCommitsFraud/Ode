import { useEffect, useState } from "react";
import { MusicBar } from "~/components/shell/MusicBar";
import { SETTINGS, Sidebar, VIEWS, type View } from "~/components/shell/Sidebar";
import { TopBar } from "~/components/shell/TopBar";
import { actions } from "~/lib/store";
import { MixerView } from "~/views/MixerView";
import { SettingsView } from "~/views/SettingsView";
import { DownloadsView, EffectsView, MusicView } from "~/views/Placeholders";
import { SoundboardView } from "~/views/SoundboardView";

const ALL_VIEWS = [...VIEWS, SETTINGS];

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
    return ALL_VIEWS.some((v) => v.id === stored) ? (stored as View) : "mixer";
  });

  useEffect(() => {
    void actions.init();
  }, []);

  const changeView = (next: View) => {
    setView(next);
    writeStorage(VIEW_KEY, next);
  };

  const title = ALL_VIEWS.find((v) => v.id === view)?.label ?? "";

  return (
    <div className="grain relative isolate flex h-full">
      <Sidebar view={view} onView={changeView} dark={dark} onToggleTheme={toggle} />
      <main className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <div className="min-h-0 flex-1 overflow-hidden">
          {view === "soundboard" && <SoundboardView />}
          {view === "music" && <MusicView />}
          {view === "mixer" && <MixerView />}
          {view === "effects" && <EffectsView />}
          {view === "downloads" && <DownloadsView />}
          {view === "settings" && <SettingsView />}
        </div>
        <MusicBar />
      </main>
    </div>
  );
}
