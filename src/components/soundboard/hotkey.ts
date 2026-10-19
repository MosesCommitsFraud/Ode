/**
 * Hotkeys. Gespeichert wird der Name, den die Hotkey-Bibliothek in Windows'
 * Tastencode übersetzt („Ctrl+Equal“, „Numpad1“, „F13“). Damit das auf jedem
 * Tastaturlayout die gedrückte Taste trifft, kommt der Name aus dem
 * layoutabhängigen Tastencode (`keyCode`), nicht aus der physischen Position
 * (`code`): Auf deutschen Tastaturen ist „+“ sonst „BracketRight“ und wird als
 * „´“ angemeldet. Zum Anzeigen wird zusätzlich die Beschriftung gespeichert.
 */

/** Windows-Tastencode → Name in US-Benennung, wie ihn die Bibliothek erwartet. */
const VK_NAMES: Record<number, string> = {
  8: "Backspace",
  9: "Tab",
  13: "Enter",
  19: "Pause",
  20: "CapsLock",
  27: "Escape",
  32: "Space",
  33: "PageUp",
  34: "PageDown",
  35: "End",
  36: "Home",
  37: "ArrowLeft",
  38: "ArrowUp",
  39: "ArrowRight",
  40: "ArrowDown",
  44: "PrintScreen",
  45: "Insert",
  46: "Delete",
  106: "NumpadMultiply",
  107: "NumpadAdd",
  109: "NumpadSubtract",
  110: "NumpadDecimal",
  111: "NumpadDivide",
  145: "ScrollLock",
  173: "AudioVolumeMute",
  174: "AudioVolumeDown",
  175: "AudioVolumeUp",
  176: "MediaTrackNext",
  177: "MediaTrackPrevious",
  178: "MediaStop",
  179: "MediaPlayPause",
  186: "Semicolon",
  187: "Equal",
  188: "Comma",
  189: "Minus",
  190: "Period",
  191: "Slash",
  192: "Backquote",
  219: "BracketLeft",
  220: "Backslash",
  221: "BracketRight",
  222: "Quote",
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "AltGraph", "Shift", "Meta", "OS"]);

function keyName(e: KeyboardEvent): string | null {
  const vk = e.keyCode;
  if (vk >= 65 && vk <= 90) return `Key${String.fromCharCode(vk)}`;
  if (vk >= 48 && vk <= 57) return `Digit${vk - 48}`;
  if (vk >= 96 && vk <= 105) return `Numpad${vk - 96}`;
  if (vk >= 112 && vk <= 135) return `F${vk - 111}`;
  if (e.code === "NumpadEnter") return "NumpadEnter";
  return VK_NAMES[vk] ?? null;
}

const KEY_LABELS: Record<string, string> = {
  Ctrl: "Strg",
  Alt: "Alt",
  Shift: "⇧",
  Super: "Win",
  " ": "Leertaste",
  Space: "Leertaste",
  Enter: "Enter",
  Escape: "Esc",
  Backspace: "⌫",
  Tab: "Tab",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  NumpadAdd: "Num +",
  NumpadSubtract: "Num −",
  NumpadMultiply: "Num ×",
  NumpadDivide: "Num ÷",
  NumpadDecimal: "Num ,",
  NumpadEnter: "Num ↵",
};

/** Gehaltene Modifier eines Tastendrucks, in fester Reihenfolge. */
export function heldModifiers(e: KeyboardEvent): string[] {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  return mods;
}

export interface RecordedHotkey {
  /** Für Windows, z. B. „Ctrl+Equal“. */
  hotkey: string;
  /** Wie auf der Tastatur beschriftet, z. B. „Ctrl++“ (Teile mit „+“ getrennt, siehe hotkeyLabel). */
  label: string;
}

/** Baut aus einem Tastendruck einen Hotkey; `null`, solange nur Modifier gedrückt sind. */
export function hotkeyFromEvent(e: KeyboardEvent): RecordedHotkey | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const name = keyName(e);
  if (!name) return null;
  const mods = heldModifiers(e);
  // Beschriftung: Ziffernblock und Sondertasten mit festem Namen, sonst das Zeichen.
  const glyph =
    name.startsWith("Numpad") || name.startsWith("F") || KEY_LABELS[name] || e.key.length !== 1
      ? name
      : e.key.toUpperCase();
  return {
    hotkey: [...mods, name].join("+"),
    // „␣“ trennt die Teile, damit auch die Taste „+“ selbst sauber bleibt.
    label: [...mods, glyph].join("␣"),
  };
}

function partLabel(part: string): string {
  if (KEY_LABELS[part]) return KEY_LABELS[part];
  if (part.startsWith("Key") && part.length === 4) return part.slice(3);
  if (part.startsWith("Digit")) return part.slice(5);
  if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`;
  return part;
}

/**
 * Lesbare Teile für <Kbd>, z. B. ["Strg", "+"]. Nimmt die gespeicherte
 * Beschriftung, sonst den Namen.
 */
export function hotkeyLabel(hotkey: string, label?: string | null): string[] {
  if (label) return label.split("␣").map(partLabel);
  return hotkey.split("+").map(partLabel);
}
