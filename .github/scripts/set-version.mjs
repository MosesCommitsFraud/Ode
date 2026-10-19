// Setzt die Version in package.json, tauri.conf.json und Cargo.toml.
// Aufruf: node .github/scripts/set-version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`Ungültige Version: ${process.argv[2] ?? "(leer)"} – erwartet z. B. 0.2.0`);
  process.exit(1);
}

/** Ersetzt nur den Wert von "version", damit die übrige Formatierung bleibt. */
function setJsonVersion(path) {
  const text = readFileSync(path, "utf8");
  const pattern = /("version"\s*:\s*")[^"]+(")/;
  if (!pattern.test(text)) {
    console.error(`Kein "version" in ${path}`);
    process.exit(1);
  }
  writeFileSync(path, text.replace(pattern, `$1${version}$2`));
}

setJsonVersion("package.json");
setJsonVersion("src-tauri/tauri.conf.json");

const cargo = readFileSync("src-tauri/Cargo.toml", "utf8");
// Nur die Version im [package]-Abschnitt, nicht die der Abhängigkeiten.
const pattern = /(\[package\][^[]*?\nversion\s*=\s*")[^"]+(")/;
if (!pattern.test(cargo)) {
  console.error("Version in src-tauri/Cargo.toml nicht gefunden");
  process.exit(1);
}
writeFileSync("src-tauri/Cargo.toml", cargo.replace(pattern, `$1${version}$2`));
console.log(`Version ${version} gesetzt`);
