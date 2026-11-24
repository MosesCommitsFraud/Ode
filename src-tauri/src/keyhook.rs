//! Globale Hotkeys über einen Low-Level-Tastatur-Hook.
//!
//! `RegisterHotKey` schluckt eine angemeldete Taste systemweit: Liegt ein Sound
//! auf „-“, lässt sich in keinem Programm mehr ein Bindestrich tippen. Der Hook
//! hört nur mit und reicht jeden Tastendruck unverändert weiter, der Hotkey
//! wirkt also zusätzlich zur normalen Funktion der Taste.

use std::cell::Cell;
use std::collections::HashSet;
use std::sync::OnceLock;

use crossbeam_channel::Sender;
use parking_lot::Mutex;

/// Modifier-Bits.
const CTRL: u8 = 1;
const ALT: u8 = 2;
const SHIFT: u8 = 4;
const SUPER: u8 = 8;

/// Eigener Code für die Enter-Taste des Ziffernblocks (Windows meldet sie als
/// VK_RETURN mit Extended-Flag).
const VK_NUMPAD_ENTER: u16 = 0x10D;

/// Eine Tastenkombination: Modifier plus Windows-Tastencode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Combo {
    mods: u8,
    vk: u16,
}

/// Liest einen gespeicherten Hotkey wie „Ctrl+Shift+Minus“, „Numpad1“ oder „F13“.
pub fn parse(hotkey: &str) -> Option<Combo> {
    let parts: Vec<&str> = hotkey.split('+').map(str::trim).collect();
    let (key, mods) = parts.split_last()?;
    let mut bits = 0;
    for m in mods {
        bits |= match m.to_ascii_lowercase().as_str() {
            "ctrl" | "control" | "cmdorctrl" | "commandorcontrol" => CTRL,
            "alt" | "option" => ALT,
            "shift" => SHIFT,
            "super" | "win" | "meta" | "cmd" | "command" => SUPER,
            _ => return None,
        };
    }
    Some(Combo {
        mods: bits,
        vk: key_code(key)?,
    })
}

/// Tastenname (US-Benennung wie im Hotkey-Rekorder) → Windows-Tastencode.
fn key_code(name: &str) -> Option<u16> {
    let lower = name.to_ascii_lowercase();
    let n = lower.as_str();
    let single = |s: &str| {
        let mut chars = s.chars();
        match (chars.next(), chars.next()) {
            (Some(c), None) => Some(c),
            _ => None,
        }
    };
    if let Some(c) = n.strip_prefix("key").and_then(single).or_else(|| single(n))
        && c.is_ascii_alphanumeric()
    {
        return Some(c.to_ascii_uppercase() as u16);
    }
    if let Some(d) = n.strip_prefix("digit").and_then(single)
        && d.is_ascii_digit()
    {
        return Some(d as u16);
    }
    if let Some(d) = n.strip_prefix("numpad").and_then(single)
        && d.is_ascii_digit()
    {
        return Some(0x60 + (d as u16 - '0' as u16));
    }
    if let Some(f) = n.strip_prefix('f').and_then(|s| s.parse::<u16>().ok())
        && (1..=24).contains(&f)
    {
        return Some(0x6F + f);
    }
    Some(match n {
        "backspace" => 0x08,
        "tab" => 0x09,
        "enter" | "return" => 0x0D,
        "numpadenter" => VK_NUMPAD_ENTER,
        "pause" => 0x13,
        "capslock" => 0x14,
        "escape" | "esc" => 0x1B,
        "space" => 0x20,
        "pageup" => 0x21,
        "pagedown" => 0x22,
        "end" => 0x23,
        "home" => 0x24,
        "arrowleft" | "left" => 0x25,
        "arrowup" | "up" => 0x26,
        "arrowright" | "right" => 0x27,
        "arrowdown" | "down" => 0x28,
        "printscreen" => 0x2C,
        "insert" => 0x2D,
        "delete" => 0x2E,
        "numpadmultiply" => 0x6A,
        "numpadadd" => 0x6B,
        "numpadsubtract" => 0x6D,
        "numpaddecimal" => 0x6E,
        "numpaddivide" => 0x6F,
        "numlock" => 0x90,
        "scrolllock" => 0x91,
        "audiovolumemute" => 0xAD,
        "audiovolumedown" => 0xAE,
        "audiovolumeup" => 0xAF,
        "mediatracknext" => 0xB0,
        "mediatrackprevious" => 0xB1,
        "mediastop" => 0xB2,
        "mediaplaypause" => 0xB3,
        "semicolon" => 0xBA,
        "equal" => 0xBB,
        "comma" => 0xBC,
        "minus" => 0xBD,
        "period" => 0xBE,
        "slash" => 0xBF,
        "backquote" => 0xC0,
        "bracketleft" => 0xDB,
        "backslash" => 0xDC,
        "bracketright" => 0xDD,
        "quote" => 0xDE,
        _ => return None,
    })
}

/// Kombinationen, auf die der Hook gerade achtet.
static ACTIVE: Mutex<Option<HashSet<Combo>>> = Mutex::new(None);
/// Hierhin meldet der Hook Treffer; ausgeführt wird außerhalb des Hooks.
static PRESSED: OnceLock<Sender<Combo>> = OnceLock::new();

thread_local! {
    /// Zuletzt gedrückte, noch nicht losgelassene Taste: Gehaltene Tasten
    /// wiederholen nur sie, damit lösen sie nicht mehrfach aus. Geht ein
    /// Loslassen verloren, setzt die nächste andere Taste das zurück.
    static LAST_DOWN: Cell<Option<u16>> = const { Cell::new(None) };
}

/// Setzt die Kombinationen, die auslösen sollen.
pub fn set_active(combos: HashSet<Combo>) {
    *ACTIVE.lock() = Some(combos);
}

/// Startet den Hook (einmal) und ruft `on_press` für jeden Treffer auf.
pub fn start(on_press: impl Fn(Combo) + Send + 'static) {
    let (tx, rx) = crossbeam_channel::unbounded();
    if PRESSED.set(tx).is_err() {
        return;
    }
    std::thread::Builder::new()
        .name("ode-hotkeys".into())
        .spawn(move || {
            for combo in rx {
                on_press(combo);
            }
        })
        .expect("Hotkey-Thread");
    #[cfg(windows)]
    win::spawn_hook();
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, KBDLLHOOKSTRUCT, LLKHF_EXTENDED, MSG,
        SetWindowsHookExW, TranslateMessage, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
        WM_SYSKEYUP,
    };

    pub fn spawn_hook() {
        std::thread::Builder::new()
            .name("ode-keyhook".into())
            .spawn(|| unsafe {
                let hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(proc), None, 0);
                if let Err(e) = hook {
                    eprintln!("Tastatur-Hook fehlgeschlagen: {e}");
                    return;
                }
                // Low-Level-Hooks laufen nur, solange dieser Thread Nachrichten abholt.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            })
            .expect("Hook-Thread");
    }

    fn held(vk: u16) -> bool {
        unsafe { GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0 }
    }

    fn is_modifier(vk: u16) -> bool {
        matches!(vk, 0x10..=0x12 | 0x5B | 0x5C | 0xA0..=0xA5)
    }

    unsafe extern "system" fn proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code >= 0 {
            let info = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
            let mut vk = info.vkCode as u16;
            if vk == 0x0D && info.flags.contains(LLKHF_EXTENDED) {
                vk = VK_NUMPAD_ENTER;
            }
            match wparam.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN if !is_modifier(vk) => {
                    if LAST_DOWN.replace(Some(vk)) != Some(vk) {
                        check(vk);
                    }
                }
                WM_KEYUP | WM_SYSKEYUP if LAST_DOWN.get() == Some(vk) => {
                    LAST_DOWN.set(None);
                }
                _ => {}
            }
        }
        // Immer weiterreichen: Ode hört nur mit und verschluckt nichts.
        unsafe { CallNextHookEx(None, code, wparam, lparam) }
    }

    fn check(vk: u16) {
        let mut mods = 0;
        if held(VK_CONTROL.0) {
            mods |= CTRL;
        }
        if held(VK_MENU.0) {
            mods |= ALT;
        }
        if held(VK_SHIFT.0) {
            mods |= SHIFT;
        }
        if held(VK_LWIN.0) || held(VK_RWIN.0) {
            mods |= SUPER;
        }
        let combo = Combo { mods, vk };
        let hit = ACTIVE
            .lock()
            .as_ref()
            .is_some_and(|set| set.contains(&combo));
        if hit && let Some(tx) = PRESSED.get() {
            let _ = tx.send(combo);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_recorder_names() {
        assert_eq!(parse("Minus"), Some(Combo { mods: 0, vk: 0xBD }));
        assert_eq!(
            parse("Ctrl+Shift+KeyA"),
            Some(Combo {
                mods: CTRL | SHIFT,
                vk: 0x41
            })
        );
        assert_eq!(parse("Numpad1").map(|c| c.vk), Some(0x61));
        assert_eq!(parse("Digit7").map(|c| c.vk), Some(0x37));
        assert_eq!(parse("F13").map(|c| c.vk), Some(0x7C));
        assert_eq!(
            parse("Alt+NumpadEnter").map(|c| c.vk),
            Some(VK_NUMPAD_ENTER)
        );
        assert_eq!(parse("Super+Equal").map(|c| c.mods), Some(SUPER));
    }

    /// Drückt F24 über SendInput und prüft, dass der Hook genau einmal auslöst.
    /// Braucht einen Desktop, daher nur auf Wunsch: `cargo test -- --ignored`.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn hook_sees_real_keypress() {
        use std::time::Duration;
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            INPUT, INPUT_0, INPUT_KEYBOARD, KEYBD_EVENT_FLAGS, KEYBDINPUT, KEYEVENTF_KEYUP,
            SendInput, VIRTUAL_KEY,
        };

        let (tx, rx) = crossbeam_channel::unbounded();
        start(move |c| {
            let _ = tx.send(c);
        });
        let f24 = parse("F24").unwrap();
        set_active([f24].into());
        std::thread::sleep(Duration::from_millis(300));

        let key = |flags| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(0x87),
                    dwFlags: flags,
                    ..Default::default()
                },
            },
        };
        let inputs = [
            key(KEYBD_EVENT_FLAGS(0)),
            key(KEYBD_EVENT_FLAGS(0)), // gehalten: Wiederholung löst nicht aus
            key(KEYEVENTF_KEYUP),
        ];
        unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) };

        assert_eq!(rx.recv_timeout(Duration::from_secs(2)), Ok(f24));
        assert!(rx.recv_timeout(Duration::from_millis(300)).is_err());
    }

    #[test]
    fn rejects_unknown() {
        assert_eq!(parse("Hyper+A"), None);
        assert_eq!(parse("Blah"), None);
        assert_eq!(parse(""), None);
        assert_eq!(parse("F25"), None);
    }
}
