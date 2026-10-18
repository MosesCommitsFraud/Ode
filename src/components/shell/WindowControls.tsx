import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "~/lib/utils";

/* Eigene Fenstersteuerung statt der Windows-Titelleiste (decorations: false).
   Gezogen wird über alle Flächen mit data-tauri-drag-region. */

const appWindow = (() => {
  try {
    return getCurrentWindow();
  } catch {
    // Im reinen Browser (vite ohne Tauri) gibt es kein Fenster.
    return null;
  }
})();

function ControlButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex h-7 w-9 cursor-default items-center justify-center rounded-control text-muted-foreground transition-colors [&_svg]:size-3.5",
        danger ? "hover:bg-error hover:text-white" : "hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!appWindow) return;
    let unlisten: (() => void) | undefined;
    const sync = () => void appWindow.isMaximized().then(setMaximized);
    sync();
    void appWindow.onResized(sync).then((fn) => (unlisten = fn));
    return () => unlisten?.();
  }, []);

  if (!appWindow) return null;

  return (
    <div className="-mr-1.5 flex items-center gap-0.5">
      <ControlButton title="Minimieren" onClick={() => void appWindow.minimize()}>
        <Minus />
      </ControlButton>
      <ControlButton
        title={maximized ? "Verkleinern" : "Maximieren"}
        onClick={() => void appWindow.toggleMaximize()}
      >
        {maximized ? <Copy className="-scale-x-100" /> : <Square className="!size-3" />}
      </ControlButton>
      <ControlButton title="Schließen" danger onClick={() => void appWindow.close()}>
        <X />
      </ControlButton>
    </div>
  );
}
