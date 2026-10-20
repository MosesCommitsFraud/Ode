// Schmale C-Schnittstelle zu Signalsmith Stretch (MIT, siehe
// signalsmith-stretch/LICENSE.txt) für Odes Stimm-Effekte: ein Kanal,
// Engine-Rate, Ein- und Ausgabe gleich lang (nur Tonhöhe, keine Dehnung).

#include "signalsmith-stretch/signalsmith-stretch.h"

#include <cstddef>

using Stretch = signalsmith::stretch::SignalsmithStretch<float>;

namespace {
// Ein Kanal als Puffer-Ansicht, wie Signalsmith sie erwartet: buffer[channel][index].
struct Mono {
    float *data;
    float *operator[](int) const { return data; }
};
struct MonoConst {
    const float *data;
    const float *operator[](int) const { return data; }
};
}

extern "C" {

Stretch *ode_stretch_new(int block_samples, int interval_samples) {
    auto *s = new Stretch();
    s->configure(1, block_samples, interval_samples, false);
    return s;
}

void ode_stretch_free(Stretch *s) { delete s; }

void ode_stretch_reset(Stretch *s) { s->reset(); }

int ode_stretch_latency(const Stretch *s) { return s->inputLatency() + s->outputLatency(); }

void ode_stretch_set_transpose(Stretch *s, float factor, float tonality_limit) { s->setTransposeFactor(factor, tonality_limit); }

// Formanten um `semitones` verschieben; `compensate` hält sie beim
// Transponieren an ihrem Platz (natürliche Stimme).
void ode_stretch_set_formant(Stretch *s, float semitones, int compensate) {
    s->setFormantSemitones(semitones, compensate != 0);
}

// Grober Grundton relativ zur Abtastrate (z. B. 150/48000), 0 = selbst schätzen.
void ode_stretch_set_formant_base(Stretch *s, float relative_freq) { s->setFormantBase(relative_freq); }

void ode_stretch_process(Stretch *s, const float *input, float *output, int samples) {
    s->process(MonoConst{input}, samples, Mono{output}, samples);
}

}
