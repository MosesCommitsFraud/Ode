/** Hotkeys im Format des Backends: "Ctrl+Alt+KeyA", "Numpad1", "F13". */

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "AltLeft",
  "AltRight",
  "ShiftLeft",
  "ShiftRight",
  "MetaLeft",
  "MetaRight",
]);

/** Baut aus einem Tastendruck einen Hotkey; `null`, solange nur Modifier gedrückt sind. */
export function hotkeyFromEvent(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");
  parts.push(e.code);
  return parts.join("+");
}

const KEY_LABELS: Record<string, string> = {
  Ctrl: "Strg",
  Alt: "Alt",
  Shift: "⇧",
  Super: "Win",
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

/** Lesbare Teile, z. B. ["Strg", "Alt", "D"]. */
export function hotkeyLabel(hotkey: string): string[] {
  return hotkey.split("+").map((part) => {
    if (KEY_LABELS[part]) return KEY_LABELS[part];
    if (part.startsWith("Key")) return part.slice(3);
    if (part.startsWith("Digit")) return part.slice(5);
    if (part.startsWith("Numpad")) return `Num ${part.slice(6)}`;
    return part;
  });
}
