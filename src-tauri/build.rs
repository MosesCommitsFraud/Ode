fn main() {
    // Signalsmith Stretch (MIT, vendor/): Tonhöhe und Formanten der
    // Stimm-Effekte. Immer optimiert, unoptimiert schafft es kein Echtzeit.
    println!("cargo:rerun-if-changed=vendor");
    // Sonst bettet ein neues App-Symbol nie in die .exe ein: die Zeile oben
    // schaltet Cargos Standard „bei jeder Änderung neu“ ab.
    println!("cargo:rerun-if-changed=icons");
    cc::Build::new()
        .cpp(true)
        .std("c++14")
        .opt_level(3)
        .debug(false)
        .warnings(false)
        .include("vendor")
        .file("vendor/ode_stretch.cpp")
        .compile("ode_stretch");

    tauri_build::build()
}
