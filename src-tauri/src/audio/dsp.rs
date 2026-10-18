use std::sync::atomic::{AtomicU32, Ordering};

/// f32, das zwischen Audio-Thread und Steuerung geteilt wird.
#[derive(Debug, Default)]
pub struct AtomicF32(AtomicU32);

impl AtomicF32 {
    pub fn new(value: f32) -> Self {
        Self(AtomicU32::new(value.to_bits()))
    }

    pub fn load(&self) -> f32 {
        f32::from_bits(self.0.load(Ordering::Relaxed))
    }

    pub fn store(&self, value: f32) {
        self.0.store(value.to_bits(), Ordering::Relaxed);
    }

    /// Hält den größten Wert seit dem letzten `take`.
    pub fn fetch_max(&self, value: f32) {
        let mut current = self.0.load(Ordering::Relaxed);
        while value > f32::from_bits(current) {
            match self.0.compare_exchange_weak(
                current,
                value.to_bits(),
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
    }

    pub fn take(&self) -> f32 {
        f32::from_bits(self.0.swap(0, Ordering::Relaxed))
    }
}

pub fn db_to_gain(db: f32) -> f32 {
    if db <= -60.0 {
        0.0
    } else {
        10f32.powf(db / 20.0)
    }
}

pub fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0, |max, s| max.max(s.abs()))
}

/// Folgt einem Zielwert weich, damit Fader-Sprünge nicht knacken.
#[derive(Debug, Clone, Copy)]
pub struct SmoothedGain {
    current: f32,
}

impl SmoothedGain {
    pub fn new(value: f32) -> Self {
        Self { current: value }
    }

    /// Wendet die Verstärkung an und gleitet dabei über den Block zum Ziel.
    pub fn apply(&mut self, samples: &mut [f32], target: f32) {
        if (self.current - target).abs() < 1e-5 {
            self.current = target;
            samples.iter_mut().for_each(|s| *s *= target);
            return;
        }
        let step = (target - self.current) / samples.len().max(1) as f32;
        for s in samples.iter_mut() {
            self.current += step;
            *s *= self.current;
        }
        self.current = target;
    }
}

/// Einfacher Spitzen-Limiter: sofortiger Angriff, exponentielles Loslassen,
/// danach hartes Begrenzen als Sicherheitsnetz.
#[derive(Debug, Clone)]
pub struct Limiter {
    ceiling: f32,
    gain: f32,
    release: f32,
}

impl Limiter {
    pub fn new(ceiling_db: f32, release_ms: f32, rate: u32) -> Self {
        let release_samples = release_ms / 1000.0 * rate as f32;
        Self {
            ceiling: db_to_gain(ceiling_db),
            gain: 1.0,
            release: (-1.0 / release_samples).exp(),
        }
    }

    pub fn process(&mut self, samples: &mut [f32]) {
        for s in samples.iter_mut() {
            let level = s.abs();
            let target = if level > self.ceiling {
                self.ceiling / level
            } else {
                1.0
            };
            self.gain = if target < self.gain {
                target
            } else {
                target + (self.gain - target) * self.release
            };
            *s = (*s * self.gain).clamp(-self.ceiling, self.ceiling);
        }
    }

    pub fn gain_reduction_db(&self) -> f32 {
        20.0 * self.gain.max(1e-6).log10()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limiter_holds_ceiling() {
        let mut limiter = Limiter::new(-1.0, 50.0, 48_000);
        let mut block = vec![2.0f32; 480];
        limiter.process(&mut block);
        let ceiling = db_to_gain(-1.0);
        assert!(block.iter().all(|s| s.abs() <= ceiling + 1e-6));
    }

    #[test]
    fn atomic_max_and_take() {
        let a = AtomicF32::new(0.0);
        a.fetch_max(0.3);
        a.fetch_max(0.1);
        assert_eq!(a.take(), 0.3);
        assert_eq!(a.load(), 0.0);
    }
}
