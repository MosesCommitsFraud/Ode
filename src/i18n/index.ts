/** Alle Wörterbücher, je Bereich eine Datei (vermeidet Konflikte beim Bearbeiten). */
import common from "./common";
import downloads from "./downloads";
import editor from "./editor";
import help from "./help";
import effects from "./effects";
import live from "./live";
import messages from "./messages";
import mixer from "./mixer";
import music from "./music";
import plugins from "./plugins";
import settings from "./settings";
import setup from "./setup";
import shell from "./shell";
import soundboard from "./soundboard";
import voice from "./voice";

export type Dictionary = { de: Record<string, string>; en: Record<string, string> };

export const dictionaries: Record<string, Dictionary> = {
  common,
  downloads,
  editor,
  help,
  effects,
  live,
  messages,
  mixer,
  music,
  plugins,
  settings,
  setup,
  shell,
  soundboard,
  voice,
};
