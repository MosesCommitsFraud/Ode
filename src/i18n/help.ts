/**
 * Erklärungen der Effekt-Seiten. Je Werkzeug: `<id>.what` (was es tut),
 * `<id>.when` (wann man es braucht), `<id>.controls` (eine Zeile je Regler,
 * „Name: Erklärung“).
 */
export default {
  de: {
    button: "Erklärung",
    title: "So funktioniert’s",
    what: "Was es macht",
    when: "Wann du es brauchst",
    controls: "Bedienung",
    close: "Schließen",
    order: "Reihenfolge der Kette: Gate → Rauschfilter → EQ → Auto-Lautstärke → Kompressor → De-Esser → Exciter → Stimm-Effekte → Limiter.",

    "gate.what": "Schaltet das Mikrofon stumm, solange es leiser ist als die Schwelle. Die Nadel zeigt deinen Pegel, die farbige Marke die Schwelle.",
    "gate.when": "Gegen Grundrauschen, Lüfter oder Tastatur in Sprechpausen. Für Klicks zwischen Wörtern eignet sich das Sprach-Gate im Rauschfilter besser.",
    "gate.controls": "Schwelle: Darunter ist das Mikrofon zu. Schieb sie knapp über die Nadel in Sprechpausen.",

    "denoise.what": "Eine KI (RNNoise) trennt Stimme von Geräuschen und entfernt Rauschen, Lüfter und Straßenlärm. Die Balken zeigen, wie sicher sie gerade Sprache hört.",
    "denoise.when": "Fast immer sinnvoll, besonders mit lautem Raum oder einfachem Headset. Kostet 10 ms Verzögerung.",
    "denoise.controls": "Sprach-Gate: Senkt alles ab, was nicht nach Sprache klingt, z. B. Klicks und Tippen zwischen Wörtern.",

    "eq.what": "Hebt oder senkt Tiefen, Präsenz und Höhen der Stimme. Die Kurve zeigt, was mit welcher Frequenz passiert.",
    "eq.when": "Dumpfe Stimme: Präsenz und Höhen etwas anheben. Dröhnt es: Bass absenken. Zischelt es: Höhen absenken oder den De-Esser nehmen.",
    "eq.controls": "Bass: 120 Hz und darunter.\nPräsenz: Verständlichkeit um 2,5 kHz.\nHöhen: Luft ab 8 kHz.\nDoppelklick auf einen Fader stellt ihn auf 0.",

    "agc.what": "Gleicht deine Lautstärke automatisch an: leise Passagen werden angehoben, laute abgesenkt. Die Nadel zeigt die aktuelle Anhebung.",
    "agc.when": "Wenn du mal nah, mal fern vom Mikrofon sitzt oder andere sagen, du seist zu leise.",
    "agc.controls": "Ziel: Wie laut deine Stimme im Mittel sein soll.\nHöchstens anheben: Begrenzt die Anhebung, damit Rauschen in Pausen nicht hochgezogen wird.",

    "compressor.what": "Macht laute Stellen leiser, damit die Stimme gleichmäßiger klingt. Die Nadel zeigt, wie stark gerade abgesenkt wird.",
    "compressor.when": "Wenn du beim Lachen oder Rufen viel lauter wirst als beim normalen Sprechen.",
    "compressor.controls": "Schwelle: Ab diesem Pegel wird abgesenkt.\nSanft, Mittel, Kräftig: Wie stark abgesenkt wird.\nAufholen: Hebt danach alles wieder an, damit es nicht leiser wird.",

    "deEsser.what": "Senkt nur die scharfen S- und Sch-Laute ab, der Rest der Stimme bleibt unberührt. Die Nadel zeigt die Absenkung.",
    "deEsser.when": "Wenn S-Laute zischen, vor allem mit Exciter oder angehobenen Höhen.",
    "deEsser.controls": "Schwelle: Ab hier wird gezähmt. Niedriger heißt stärker.\nAb Frequenz: Wo die Zischlaute liegen, meist 5–8 kHz.",

    "exciter.what": "Erzeugt neue Obertöne in den Höhen. Die Stimme klingt präsenter und klarer, ohne einfach nur lauter zu werden.",
    "exciter.when": "Bei dumpfen Mikrofonen oder wenn die Stimme in der Musik untergeht.",
    "exciter.controls": "Ab Frequenz: Ab hier werden Obertöne ergänzt.\nStärke: Wie viel. Wenig reicht meist.",

    "limiter.what": "Eine harte Obergrenze. Nichts kommt darüber, auch kein Schrei. Die Nadel zeigt, wann er greift.",
    "limiter.when": "Immer als letzte Sicherung, damit niemand im Call Ohrenschmerzen bekommt.",
    "limiter.controls": "Obergrenze: Höchster Pegel, der rausgeht. −3 dB ist ein guter Wert.",

    "presets.what": "Fertige Stimmen auf Tasten wie an einem Effektgerät. Ein Preset speichert alle Einstellungen der Seiten Tonhöhe und Klang.",
    "presets.when": "Zum schnellen Umschalten im Spiel oder Stream, am besten per Hotkey.",
    "presets.controls": "Taste drücken: Preset ein. Nochmal drücken: Stimm-Effekte aus.\nRechtsklick oder Stift: Name, Symbol, Farbe und Hotkey ändern.\nHotkey: Wirkt überall in Windows, ein zweiter Druck schaltet wieder aus.\nAls Preset speichern: Deine aktuelle Einstellung wird eine neue Taste.\nPfeil im Kreis: Holt die mitgelieferten Presets zurück.",

    "pitch.what": "Macht deine Stimme höher oder tiefer. Die Formanten bestimmen die Klangfarbe, also ob du nach Kind, Erwachsenem oder Riese klingst.",
    "pitch.when": "Für Helium, Monster und Verstellen der Stimme. Kostet etwa 40 ms Verzögerung.",
    "pitch.controls": "Halbtöne: Tonhöhe, 12 = eine Oktave.\nFormant: Klangfarbe getrennt von der Tonhöhe. Plus = kleiner und heller, Minus = größer und dunkler.",

    "autotune.what": "Zieht deine Stimme auf die nächste richtige Note. Links die Kurve (grau gesungen, farbig korrigiert), rechts das Stimmgerät mit der Abweichung in Cent.",
    "autotune.when": "Zum Singen: sanft für sauberen Gesang, sofort für den bekannten Roboter-Effekt.",
    "autotune.controls": "Tonart: Grundton auf der Klaviatur. Die Tasten der Skala haben einen Strich.\nSkala: Welche Noten erlaubt sind. Chromatisch erlaubt alle.\nGeschwindigkeit: Sofort ergibt den harten Effekt, höher klingt natürlicher.",

    "harmonizer.what": "Fügt bis zu zwei zusätzliche Stimmen hinzu, die im festen Abstand mitsingen.",
    "harmonizer.when": "Für Chor-Effekte und mehrstimmigen Gesang.",
    "harmonizer.controls": "1 / 2: Stimme an oder aus.\nAbstand: In Halbtönen. +4 große Terz, +7 Quinte, +12 Oktave, Minus darunter.\nLautstärke: Wie laut die Stimme mitsingt.",

    "vocoder.what": "Deine Sprache steuert einen Synthesizer. Du klingst wie ein singender Roboter (Daft Punk). Die Balken zeigen die 16 Frequenzbänder.",
    "vocoder.when": "Für Roboter-Gesang und Electro-Effekte.",
    "vocoder.controls": "Akkord: Einzelton, Quinte, Dur oder Moll.\nFolgen: Der Synthesizer singt deine Tonhöhe mit, statt einer festen Note.\nNote: Feste Note, wenn Folgen aus ist.\nRauschen: Für verständliche Zischlaute.\nAnteil: Mischung mit der echten Stimme.",

    "character.what": "Färbt den Klang. Die Kurve zeigt, was mit einer Schwingung passiert (gestrichelt vorher, farbig nachher).",
    "character.when": "Roboter, Funkgerät, Telefon, Megafon, Verzerrung, Bitcrusher (Retro-Spiel) oder Lo-Fi (alte Kassette).",
    "character.controls": "Modus: Die Tasten wählen den Klang.\nStärke: Wie heftig.\nZweiter Regler: je nach Modus Trägerfrequenz, Band, Bandbreite, Resonanz, Höhen oder Abtastrate.\nAnteil: Mischung mit der unbearbeiteten Stimme.",

    "modulation.what": "Bewegt den Klang mit einem langsamen Oszillator. Die Kurven zeigen die Bewegung über 2 Sekunden.",
    "modulation.when": "Chorus macht breiter und voller, Flanger rauscht wie ein Düsenjet, Phaser schimmert.",
    "modulation.controls": "Modus: Chorus, Flanger oder Phaser.\nTempo: Wie schnell es sich bewegt.\nTiefe: Wie stark.\nRückkopplung: Schärfe bei Flanger und Phaser.\nAnteil: Mischung.",

    "echo.what": "Wiederholt deine Stimme. Die Striche zeigen die Wiederholungen über 2 Sekunden.",
    "echo.when": "Für Ansagen, Höhle oder Berg, Gesang.",
    "echo.controls": "Zeit: Abstand der Wiederholungen.\nRückkopplung: Wie viele Wiederholungen.\nHöhen: Darüber wird jede Wiederholung dunkler, wie bei alten Bandechos.\nAnteil: Lautstärke des Echos.",

    "reverb.what": "Lässt dich klingen, als stündest du in einem Raum. Die Kurve zeigt, wie der Hall abklingt.",
    "reverb.when": "Etwas Hall macht Gesang voller, viel Hall klingt nach Halle oder Kathedrale.",
    "reverb.controls": "Größe: Vom Zimmer bis zur Kathedrale.\nDämpfung: Wie weich der Raum ist.\nVorlauf: Pause, bevor der Hall einsetzt. Mehr hält die Stimme klar.\nAnteil: Lautstärke des Halls.",
  },
  en: {
    button: "Explain",
    title: "How it works",
    what: "What it does",
    when: "When you need it",
    controls: "Controls",
    close: "Close",
    order: "Chain order: gate → noise filter → EQ → auto volume → compressor → de-esser → exciter → voice effects → limiter.",

    "gate.what": "Mutes the microphone while it is quieter than the threshold. The needle shows your level, the colored mark the threshold.",
    "gate.when": "Against background hiss, fans or keyboard in pauses. For clicks between words, the voice gate in the noise filter works better.",
    "gate.controls": "Threshold: below this the mic is closed. Set it just above the needle during pauses.",

    "denoise.what": "An AI (RNNoise) separates voice from noise and removes hiss, fans and traffic. The bars show how sure it is that it hears speech.",
    "denoise.when": "Almost always useful, especially in a loud room or with a simple headset. Adds 10 ms of delay.",
    "denoise.controls": "Voice gate: lowers everything that does not sound like speech, e.g. clicks and typing between words.",

    "eq.what": "Raises or lowers the lows, presence and highs of your voice. The curve shows what happens at which frequency.",
    "eq.when": "Muffled voice: raise presence and highs a little. Boomy: lower the bass. Hissy: lower the highs or use the de-esser.",
    "eq.controls": "Bass: 120 Hz and below.\nPresence: clarity around 2.5 kHz.\nTreble: air above 8 kHz.\nDouble-click a knob to reset it to 0.",

    "agc.what": "Evens out your volume automatically: quiet parts are raised, loud ones lowered. The needle shows the current boost.",
    "agc.when": "If you move closer to and away from the mic, or others say you are too quiet.",
    "agc.controls": "Target: how loud your voice should be on average.\nMax boost: limits the boost so noise in pauses is not pulled up.",

    "compressor.what": "Makes loud parts quieter so your voice sounds more even. The needle shows how much is being reduced.",
    "compressor.when": "If you get much louder when laughing or shouting than when talking.",
    "compressor.controls": "Threshold: reduction starts above this level.\nGentle, Medium, Strong: how strongly it reduces.\nMakeup: raises everything afterwards so it does not get quieter.",

    "deEsser.what": "Lowers only sharp S and SH sounds, the rest of your voice stays untouched. The needle shows the reduction.",
    "deEsser.when": "When S sounds hiss, especially with the exciter or raised highs.",
    "deEsser.controls": "Threshold: taming starts here. Lower means stronger.\nAbove: where the hiss sits, usually 5–8 kHz.",

    "exciter.what": "Creates new harmonics in the highs. Your voice sounds more present and clear without simply getting louder.",
    "exciter.when": "With dull microphones or when your voice gets lost in music.",
    "exciter.controls": "Above: harmonics are added from here up.\nAmount: how much. A little is usually enough.",

    "limiter.what": "A hard ceiling. Nothing gets above it, not even a scream. The needle shows when it acts.",
    "limiter.when": "Always, as the last safety net, so nobody in the call gets hurt ears.",
    "limiter.controls": "Ceiling: the highest level that goes out. −3 dB is a good value.",

    "presets.what": "Ready-made voices on keys, like on an effects unit. A preset stores everything on the Pitch and Sound pages.",
    "presets.when": "For switching quickly in a game or stream, best with a hotkey.",
    "presets.controls": "Press a key: preset on. Press again: voice effects off.\nRight-click or pencil: change name, icon, color and hotkey.\nHotkey: works everywhere in Windows, pressing it again turns it off.\nSave as preset: your current settings become a new key.\nCircular arrow: brings back the included presets.",

    "pitch.what": "Makes your voice higher or lower. Formants set the timbre, i.e. whether you sound like a child, an adult or a giant.",
    "pitch.when": "For helium, monsters and disguising your voice. Adds about 40 ms of delay.",
    "pitch.controls": "Semitones: pitch, 12 = one octave.\nFormant: timbre separate from pitch. Plus = smaller and brighter, minus = bigger and darker.",

    "autotune.what": "Pulls your voice to the nearest correct note. Left the curve (gray sung, colored corrected), right the tuner with the deviation in cents.",
    "autotune.when": "For singing: gentle for clean vocals, instant for the famous robotic effect.",
    "autotune.controls": "Key: root note on the keyboard. The keys of the scale have a line.\nScale: which notes are allowed. Chromatic allows all.\nSpeed: instant gives the hard effect, higher sounds more natural.",

    "harmonizer.what": "Adds up to two extra voices that sing along at a fixed interval.",
    "harmonizer.when": "For choir effects and harmonies.",
    "harmonizer.controls": "1 / 2: voice on or off.\nInterval: in semitones. +4 major third, +7 fifth, +12 octave, minus below.\nLevel: how loud the voice sings along.",

    "vocoder.what": "Your speech controls a synthesizer, so you sound like a singing robot (Daft Punk). The bars show the 16 frequency bands.",
    "vocoder.when": "For robot vocals and electro effects.",
    "vocoder.controls": "Chord: single note, fifth, major or minor.\nFollow: the synth sings your pitch instead of a fixed note.\nNote: fixed note when Follow is off.\nNoise: keeps S sounds understandable.\nMix: blend with your real voice.",

    "character.what": "Colors the sound. The curve shows what happens to a waveform (dashed before, colored after).",
    "character.when": "Robot, radio, phone, megaphone, distortion, bitcrusher (retro game) or lo-fi (old cassette).",
    "character.controls": "Mode: the keys choose the sound.\nAmount: how strong.\nSecond knob: carrier, band, bandwidth, resonance, highs or sample rate, depending on the mode.\nMix: blend with the untouched voice.",

    "modulation.what": "Moves the sound with a slow oscillator. The curves show the movement over 2 seconds.",
    "modulation.when": "Chorus makes it wider and fuller, flanger swooshes like a jet, phaser shimmers.",
    "modulation.controls": "Mode: chorus, flanger or phaser.\nRate: how fast it moves.\nDepth: how strong.\nFeedback: sharpness for flanger and phaser.\nMix: blend.",

    "echo.what": "Repeats your voice. The lines show the repeats over 2 seconds.",
    "echo.when": "For announcements, caves or mountains, singing.",
    "echo.controls": "Time: spacing of the repeats.\nFeedback: how many repeats.\nHighs: each repeat gets darker above this, like old tape echoes.\nMix: echo volume.",

    "reverb.what": "Makes you sound like you are standing in a room. The curve shows how the reverb fades.",
    "reverb.when": "A little reverb makes vocals fuller, a lot sounds like a hall or cathedral.",
    "reverb.controls": "Size: from a small room to a cathedral.\nDamping: how soft the room is.\nPre-delay: pause before the reverb starts. More keeps your voice clear.\nMix: reverb volume.",
  },
};
