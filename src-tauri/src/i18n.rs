//! Sprache für Texte, die das Backend selbst zeigt (Tray-Menü, Meldungen,
//! Fortschritt). Die Oberfläche hat ihre eigenen Wörterbücher (src/i18n);
//! hier reicht ein Schalter Deutsch/Englisch.

use std::sync::atomic::{AtomicBool, Ordering};

static ENGLISH: AtomicBool = AtomicBool::new(false);

pub fn set_language(language: &str) {
    ENGLISH.store(language == "en", Ordering::Relaxed);
}

pub fn english() -> bool {
    ENGLISH.load(Ordering::Relaxed)
}

/// Text in der eingestellten Sprache: `tr!("Deutsch", "English")`, auch mit
/// Platzhaltern wie bei `format!`: `tr!("{n} Titel", "{n} tracks")`.
#[macro_export]
macro_rules! tr {
    ($de:literal, $en:literal $(,)?) => {
        // format! auch ohne Argumente, damit Platzhalter wie {e} ersetzt werden.
        if $crate::i18n::english() { format!($en) } else { format!($de) }
    };
    ($de:literal, $en:literal, $($arg:tt)+) => {
        if $crate::i18n::english() { format!($en, $($arg)+) } else { format!($de, $($arg)+) }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn switches_language() {
        set_language("en");
        let name = "Ode";
        assert_eq!(tr!("{name} öffnen", "Open {name}"), "Open Ode");
        set_language("de");
        assert_eq!(tr!("{name} öffnen", "Open {name}"), "Ode öffnen");
        assert_eq!(tr!("Beenden", "Quit"), "Beenden");
        let e = "x";
        assert_eq!(tr!("Fehler: {e}", "Error: {e}"), "Fehler: x");
    }
}
