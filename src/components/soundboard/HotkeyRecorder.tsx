import { X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "~/components/ui/button";
import { Kbd } from "~/components/ui/misc";
import { useT } from "~/lib/i18n";
import { cn } from "~/lib/utils";
import { heldModifiers, hotkeyFromEvent, hotkeyLabel } from "./hotkey";

/** Feld, das den nächsten Tastendruck als Hotkey aufnimmt; Esc bricht ab. */
export function HotkeyRecorder({
  value,
  label,
  onChange,
}: {
  value: string | null;
  label: string | null;
  onChange: (hotkey: string | null, label: string | null) => void;
}) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  // Gerade gehaltene Modifier, damit man sieht, dass die Kombination ankommt.
  const [held, setHeld] = useState<string[]>([]);
  // Aktueller Callback ohne Neuanmeldung des Listeners: Der Editor rendert mit
  // den Pegeln ständig neu, das würde sonst die gehaltenen Tasten zurücksetzen.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!recording) return;
    const onDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape" && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        setRecording(false);
        return;
      }
      const recorded = hotkeyFromEvent(e);
      if (recorded) {
        onChangeRef.current(recorded.hotkey, recorded.label);
        setRecording(false);
      } else {
        setHeld(heldModifiers(e));
      }
    };
    const onUp = (e: KeyboardEvent) => setHeld(heldModifiers(e));
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      setHeld([]);
    };
  }, [recording]);

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setRecording((r) => !r)}
        className={cn(
          "well flex h-10 flex-1 cursor-default items-center gap-1.5 rounded-xl px-3 text-left text-sm transition-shadow",
          recording && "shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        {recording ? (
          <>
            {hotkeyLabel(held.join("+")).filter(Boolean).map((k) => (
              <Kbd key={k}>{k}</Kbd>
            ))}
            <Kbd className="animate-pulse">…</Kbd>
            <span className="ml-auto text-2xs text-muted-foreground">
              <Kbd>Esc</Kbd>
            </span>
          </>
        ) : value ? (
          hotkeyLabel(value, label).map((k, i) => <Kbd key={`${i}-${k}`}>{k}</Kbd>)
        ) : (
          <Kbd className="opacity-60">…</Kbd>
        )}
      </button>
      {value && !recording && (
        <Button variant="ghost" size="icon-sm" title={t("editor.removeHotkey")} onClick={() => onChange(null, null)}>
          <X />
        </Button>
      )}
    </div>
  );
}
