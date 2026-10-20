import {
  Alien,
  Balloon,
  Butterfly,
  CassetteTape,
  Cat,
  Church,
  Crown,
  Detective,
  Dog,
  Fire,
  Ghost,
  Headset,
  Heart,
  Lightning,
  MaskHappy,
  Megaphone,
  Microphone,
  Mountains,
  MusicNote,
  MusicNotes,
  Person,
  Phone,
  PianoKeys,
  Planet,
  Radio,
  Robot,
  Skull,
  Smiley,
  Snowflake,
  Star,
  Television,
  UsersThree,
  Waveform,
  type Icon,
} from "@phosphor-icons/react";
import { getLang } from "~/lib/i18n";

/** Symbole für Presets; gespeichert wird der Schlüssel. */
export const PRESET_ICONS: Record<string, Icon> = {
  waveform: Waveform,
  microphone: Microphone,
  balloon: Balloon,
  person: Person,
  skull: Skull,
  robot: Robot,
  radio: Radio,
  phone: Phone,
  megaphone: Megaphone,
  mountains: Mountains,
  church: Church,
  "music-notes": MusicNotes,
  "music-note": MusicNote,
  "users-three": UsersThree,
  "piano-keys": PianoKeys,
  alien: Alien,
  ghost: Ghost,
  "cassette-tape": CassetteTape,
  cat: Cat,
  dog: Dog,
  butterfly: Butterfly,
  crown: Crown,
  detective: Detective,
  fire: Fire,
  heart: Heart,
  lightning: Lightning,
  "mask-happy": MaskHappy,
  planet: Planet,
  smiley: Smiley,
  snowflake: Snowflake,
  star: Star,
  television: Television,
  headset: Headset,
};

export function PresetIcon({ name, ...props }: { name: string } & React.ComponentProps<Icon>) {
  const Component = PRESET_ICONS[name] ?? Waveform;
  return <Component {...props} />;
}

const NAMES_DE = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "H"];
const NAMES_EN = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];

/** Name eines Tons ohne Oktave, 0 = C. */
export function keyName(key: number) {
  return (getLang() === "de" ? NAMES_DE : NAMES_EN)[((key % 12) + 12) % 12];
}

/** Midi-Note → „A3“ (60 = C4). */
export function noteName(note: number) {
  const n = Math.round(note);
  return `${keyName(n)}${Math.floor(n / 12) - 1}`;
}

export function noteOf(hz: number) {
  return 69 + 12 * Math.log2(hz / 440);
}

const SCALE_DEGREES: Record<string, number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
};

export function inScale(note: number, key: number, scale: string) {
  return (SCALE_DEGREES[scale] ?? SCALE_DEGREES.chromatic).includes((((note - key) % 12) + 12) % 12);
}
