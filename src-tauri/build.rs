fn main() {
    // Signalsmith Stretch (MIT, vendor/): Tonhöhe und Formanten der
    // Stimm-Effekte. Immer optimiert, unoptimiert schafft es kein Echtzeit.
    println!("cargo:rerun-if-changed=vendor");
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
