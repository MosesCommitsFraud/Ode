// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Unsichtbarer Plugin-Hilfsprozess, von Ode selbst gestartet (vor Tauri,
    // damit er weder Fenster noch Einzelinstanz-Sperre anfasst).
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--plugin-host") {
        std::process::exit(ode_lib::plugins::host_main(args.get(2).map(String::as_str)));
    }
    ode_lib::run()
}
