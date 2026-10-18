//! Lineares Resampling zwischen Geräte-Rate und Engine-Rate. Reicht für den
//! Anfang; später übernimmt `rubato` die Qualitätsstufe.

/// Nimmt Samples entgegen und gibt sie in der Zielrate aus.
#[derive(Debug, Clone)]
pub struct PushResampler {
    step: f64,
    pos: f64,
    prev: f32,
}

impl PushResampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            step: from_rate as f64 / to_rate as f64,
            pos: 0.0,
            prev: 0.0,
        }
    }

    pub fn is_passthrough(&self) -> bool {
        self.step == 1.0
    }

    pub fn process(&mut self, input: &[f32], mut emit: impl FnMut(f32)) {
        for &x in input {
            while self.pos < 1.0 {
                emit(self.prev + (x - self.prev) * self.pos as f32);
                self.pos += self.step;
            }
            self.pos -= 1.0;
            self.prev = x;
        }
    }
}

/// Holt Samples aus einer Quelle und liefert sie in der Zielrate.
#[derive(Debug, Clone)]
pub struct PullResampler {
    step: f64,
    pos: f64,
    prev: f32,
    cur: f32,
}

impl PullResampler {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            step: from_rate as f64 / to_rate as f64,
            pos: 0.0,
            prev: 0.0,
            cur: 0.0,
        }
    }

    pub fn is_passthrough(&self) -> bool {
        self.step == 1.0
    }

    pub fn process(&mut self, output: &mut [f32], mut next: impl FnMut() -> f32) {
        for out in output.iter_mut() {
            while self.pos >= 1.0 {
                self.prev = self.cur;
                self.cur = next();
                self.pos -= 1.0;
            }
            *out = self.prev + (self.cur - self.prev) * self.pos as f32;
            self.pos += self.step;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn push_resampler_ratio() {
        let mut r = PushResampler::new(44_100, 48_000);
        let mut count = 0;
        r.process(&vec![0.5; 44_100], |_| count += 1);
        assert!((count as i32 - 48_000).abs() <= 1);
    }

    #[test]
    fn pull_resampler_ratio() {
        let mut r = PullResampler::new(48_000, 44_100);
        let mut pulled = 0;
        let mut out = vec![0.0; 44_100];
        r.process(&mut out, || {
            pulled += 1;
            0.5
        });
        assert!((pulled as i32 - 48_000).abs() <= 2);
    }
}
