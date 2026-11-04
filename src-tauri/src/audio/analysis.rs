use super::pitch;
use serde::Serialize;
use std::collections::VecDeque;

pub const MINIMUM_HZ: f64 = 25.0;
pub const MAXIMUM_HZ: f64 = 1500.0;
const WINDOW: usize = 2048;

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum SignalState {
    Warming,
    Silence,
    Unstable,
    Stable,
    Clipping,
    Error,
    Stopped,
}
/// A note attack: capture time (same clock as `audio_time_ms`) and how far the
/// attack energy rose above the previous 20 ms.
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Onset {
    pub audio_time_ms: f64,
    pub strength_db: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Signal {
    pub state: SignalState,
    pub frequency: Option<f64>,
    pub level_db: f64,
    pub peak: f32,
    pub confidence: f64,
    /// Attacks since the previous observation, oldest first.
    pub onsets: Vec<Onset>,
}
impl Signal {
    pub fn empty(state: SignalState) -> Self {
        Self {
            state,
            frequency: None,
            level_db: -120.0,
            peak: 0.0,
            confidence: 0.0,
            onsets: Vec::new(),
        }
    }
}

const ONSET_HOP_SECONDS: f64 = 0.005;
const ONSET_RISE_DB: f64 = 9.0;
const ONSET_REFRACTORY_SECONDS: f64 = 0.05;
const ONSET_HISTORY_HOPS: usize = 4;
const ONSET_PENDING_LIMIT: usize = 16;

/// Attack detector at the native rate. Every 5 ms it measures the energy of
/// the sample-to-sample difference (a simple high-pass that favours pick
/// transients over sustained pitch). An onset is a rise of at least 9 dB over
/// the quietest of the previous 20 ms while the broadband level is above the
/// gate and not falling, at least 50 ms after the previous onset. A steady tone
/// gives a flat difference energy and so no onsets; a mute cuts the level, so
/// its click is not an attack.
struct OnsetDetector {
    rate: f64,
    hop: usize,
    count: usize,
    difference: f64,
    broadband: f64,
    previous: f64,
    previous_level: f64,
    history: VecDeque<f64>,
    last_onset: Option<u64>,
    refractory: u64,
    gate_db: f64,
    pending: Vec<Onset>,
}
impl OnsetDetector {
    fn new(rate: f64, gate_db: f64) -> Self {
        Self {
            rate,
            hop: (rate * ONSET_HOP_SECONDS).round().max(1.0) as usize,
            count: 0,
            difference: 0.0,
            broadband: 0.0,
            previous: 0.0,
            previous_level: -120.0,
            history: VecDeque::with_capacity(ONSET_HISTORY_HOPS + 1),
            last_onset: None,
            refractory: (rate * ONSET_REFRACTORY_SECONDS) as u64,
            gate_db,
            pending: Vec::with_capacity(ONSET_PENDING_LIMIT),
        }
    }
    fn reset(&mut self) {
        self.count = 0;
        self.difference = 0.0;
        self.broadband = 0.0;
        self.previous = 0.0;
        self.previous_level = -120.0;
        self.history.clear();
        self.last_onset = None;
        self.pending.clear();
    }
    fn push(&mut self, sample: f64, frame: u64) {
        let step = sample - self.previous;
        self.previous = sample;
        self.difference += step * step;
        self.broadband += sample * sample;
        self.count += 1;
        if self.count < self.hop {
            return;
        }
        let n = self.count as f64;
        let flux_db = 10.0 * (self.difference / n + 1e-12).log10();
        let level_db = 10.0 * (self.broadband / n + 1e-12).log10();
        self.count = 0;
        self.difference = 0.0;
        self.broadband = 0.0;
        if let Some(quietest) = self.history.iter().copied().reduce(f64::min) {
            let rise = flux_db - quietest;
            let rested = self
                .last_onset
                .is_none_or(|last| frame.saturating_sub(last) >= self.refractory);
            let rising = level_db >= self.previous_level - 0.5;
            if rise >= ONSET_RISE_DB
                && level_db >= self.gate_db
                && rising
                && rested
                && self.pending.len() < ONSET_PENDING_LIMIT
            {
                // The attack lies somewhere in this hop; report its middle.
                let at = frame.saturating_sub(self.hop as u64 / 2);
                self.pending.push(Onset {
                    audio_time_ms: at as f64 / self.rate * 1000.0,
                    strength_db: rise,
                });
                self.last_onset = Some(frame);
            }
        }
        self.previous_level = level_db;
        if self.history.len() == ONSET_HISTORY_HOPS {
            self.history.pop_front();
        }
        self.history.push_back(flux_db);
    }
    fn take(&mut self) -> Vec<Onset> {
        std::mem::take(&mut self.pending)
    }
}

struct LowPass {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z1: f64,
    z2: f64,
}
impl LowPass {
    fn new(rate: f64, cutoff: f64, q: f64) -> Self {
        let w = 2.0 * std::f64::consts::PI * cutoff / rate;
        let c = w.cos();
        let alpha = w.sin() / (2.0 * q);
        let a0 = 1.0 + alpha;
        Self {
            b0: (1.0 - c) / 2.0 / a0,
            b1: (1.0 - c) / a0,
            b2: (1.0 - c) / 2.0 / a0,
            a1: -2.0 * c / a0,
            a2: (1.0 - alpha) / a0,
            z1: 0.0,
            z2: 0.0,
        }
    }
    fn push(&mut self, sample: f64) -> f64 {
        let out = self.b0 * sample + self.z1;
        self.z1 = self.b1 * sample - self.a1 * out + self.z2;
        self.z2 = self.b2 * sample - self.a2 * out;
        out
    }
    fn reset(&mut self) {
        self.z1 = 0.0;
        self.z2 = 0.0;
    }
}

pub struct Analyzer {
    native_rate: f64,
    pub analysis_rate: f64,
    step: usize,
    phase: usize,
    filters: [LowPass; 2],
    window: VecDeque<f32>,
    samples: Vec<f32>,
    level: VecDeque<f32>,
    level_size: usize,
    sum: f64,
    squares: f64,
    history: VecDeque<f64>,
    last_frame: Option<u64>,
    invalid: bool,
    gate_db: f64,
    onsets: OnsetDetector,
}
impl Analyzer {
    pub fn new(rate: u32, gate_db: f64) -> Self {
        let native_rate = rate as f64;
        let step = (native_rate / 12000.0).round().max(1.0) as usize;
        let analysis_rate = native_rate / step as f64;
        let cutoff = 1800.0_f64.min(analysis_rate * 0.3);
        let level_size = (native_rate * 0.06).ceil() as usize;
        Self {
            native_rate,
            analysis_rate,
            step,
            phase: 0,
            filters: [
                LowPass::new(native_rate, cutoff, 0.5411961),
                LowPass::new(native_rate, cutoff, 1.306563),
            ],
            window: VecDeque::with_capacity(WINDOW),
            samples: Vec::with_capacity(WINDOW),
            level: VecDeque::with_capacity(level_size),
            level_size,
            sum: 0.0,
            squares: 0.0,
            history: VecDeque::with_capacity(3),
            last_frame: None,
            invalid: false,
            gate_db,
            onsets: OnsetDetector::new(native_rate, gate_db),
        }
    }
    pub fn reset(&mut self) {
        self.window.clear();
        self.level.clear();
        self.history.clear();
        self.sum = 0.0;
        self.squares = 0.0;
        self.phase = 0;
        self.filters.iter_mut().for_each(LowPass::reset);
        self.onsets.reset();
    }
    pub fn push(&mut self, sample: f32, frame: u64) {
        if self
            .last_frame
            .is_some_and(|last| frame <= last || frame - last > (self.native_rate * 0.02) as u64)
        {
            self.reset();
            self.invalid = true;
        }
        self.last_frame = Some(frame);
        if !sample.is_finite() {
            self.reset();
            self.invalid = true;
            return;
        }
        if self.level.len() == self.level_size {
            let old = self.level.pop_front().unwrap() as f64;
            self.sum -= old;
            self.squares -= old * old;
        }
        self.level.push_back(sample);
        self.sum += sample as f64;
        self.squares += (sample as f64).powi(2);
        self.onsets.push(sample as f64, frame);
        let first = self.filters[0].push(sample as f64);
        let filtered = self.filters[1].push(first) as f32;
        self.phase += 1;
        if self.phase >= self.step {
            self.phase = 0;
            if self.window.len() == WINDOW {
                self.window.pop_front();
            }
            self.window.push_back(filtered);
        }
    }
    pub fn audio_time_ms(&self) -> f64 {
        self.last_frame.unwrap_or(0) as f64 / self.native_rate * 1000.0
    }
    pub fn analyze(&mut self) -> Signal {
        let length = self.level.len().max(1) as f64;
        let rms = (self.squares / length - (self.sum / length).powi(2))
            .max(0.0)
            .sqrt();
        let mut result = Signal {
            level_db: (20.0 * rms.max(1e-6).log10()).clamp(-120.0, 6.0),
            peak: self.level.iter().map(|v| v.abs()).fold(0.0_f32, f32::max),
            onsets: self.onsets.take(),
            ..Signal::empty(SignalState::Unstable)
        };
        if self.invalid {
            self.invalid = false;
            self.history.clear();
            return result;
        }
        if result.level_db < self.gate_db {
            self.history.clear();
            result.state = SignalState::Silence;
            return result;
        }
        if result.peak >= 0.995 {
            self.history.clear();
            result.state = SignalState::Clipping;
            return result;
        }
        if self.window.len() < WINDOW {
            self.history.clear();
            result.state = SignalState::Warming;
            return result;
        }
        self.samples.clear();
        self.samples.extend(self.window.iter().copied());
        let Some(estimate) =
            pitch::estimate(&self.samples, self.analysis_rate, MINIMUM_HZ, MAXIMUM_HZ)
        else {
            self.history.clear();
            return result;
        };
        if estimate.confidence < 0.85 {
            self.history.clear();
            return result;
        }
        if self
            .history
            .back()
            .is_some_and(|old| (1200.0 * (estimate.frequency / old).log2()).abs() > 30.0)
        {
            self.history.clear();
        }
        if self.history.len() == 3 {
            self.history.pop_front();
        }
        self.history.push_back(estimate.frequency);
        result.confidence = estimate.confidence;
        if self.history.len() == 3 {
            let mut sorted = [self.history[0], self.history[1], self.history[2]];
            sorted.sort_by(f64::total_cmp);
            if (1200.0 * (sorted[2] / sorted[0]).log2()).abs() <= 30.0 {
                result.state = SignalState::Stable;
                result.frequency = Some(sorted[1]);
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn feed(
        analyzer: &mut Analyzer,
        rate: u32,
        frequency: f64,
        seconds: f64,
        offset: u64,
    ) -> Vec<Signal> {
        let mut signals = Vec::new();
        for n in 0..(rate as f64 * seconds) as u64 {
            let phase = 2.0 * std::f64::consts::PI * frequency * n as f64 / rate as f64;
            analyzer.push(
                (0.22 * phase.sin()
                    + 0.13 * (2.0 * phase).sin()
                    + 0.06 * (3.0 * phase).sin()
                    + 0.05) as f32,
                offset + n,
            );
            if n % (rate as u64 / 15) == 0 {
                signals.push(analyzer.analyze());
            }
        }
        signals
    }
    #[test]
    fn streaming_low_notes_sample_rates_and_silence() {
        for rate in [44100, 48000, 96000] {
            for frequency in [27.5, 30.8677, 41.2034, 82.4069, 329.6276, 659.2551] {
                let mut analyzer = Analyzer::new(rate, -55.0);
                let signals = feed(&mut analyzer, rate, frequency, 0.65, 0);
                let first = signals
                    .iter()
                    .position(|s| s.state == SignalState::Stable)
                    .expect("stable pitch");
                assert!(first as f64 / 15.0 < 0.5, "{rate} {frequency} latency");
                let final_signal = signals.last().unwrap();
                assert!(
                    (1200.0 * (final_signal.frequency.unwrap() / frequency).log2()).abs() < 5.0,
                    "{rate} {frequency}"
                );
                for n in (rate as f64 * 0.65) as u64..(rate as f64 * 0.8) as u64 {
                    analyzer.push(0.0, n);
                }
                let silent = analyzer.analyze();
                assert_eq!(silent.state, SignalState::Silence);
                assert_eq!(silent.frequency, None);
            }
        }
    }
    #[test]
    fn clipping_noise_discontinuity_and_pitch_change_clear_success() {
        let mut analyzer = Analyzer::new(48000, -55.0);
        feed(&mut analyzer, 48000, 110.0, 0.6, 0);
        assert_eq!(analyzer.analyze().state, SignalState::Stable);
        analyzer.push(f32::NAN, 28800);
        assert_ne!(analyzer.analyze().state, SignalState::Stable);
        analyzer.reset();
        for n in 28801..48801 {
            analyzer.push(if n % 2 == 0 { 1.0 } else { -1.0 }, n);
        }
        assert_eq!(analyzer.analyze().state, SignalState::Clipping);
        analyzer.reset();
        let mut rng = 1_u32;
        for n in 48801..68801 {
            rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
            analyzer.push((rng as f64 / u32::MAX as f64 * 0.4 - 0.2) as f32, n);
        }
        assert_eq!(analyzer.analyze().frequency, None);
        analyzer.reset();
        feed(&mut analyzer, 48000, 110.0, 0.6, 70000);
        analyzer.push(0.1, 200000);
        assert_ne!(analyzer.analyze().state, SignalState::Stable);
    }

    /// Plucked notes: each attack restarts a decaying 110 Hz tone with harmonics.
    /// `muted` silences the string 80 ms before the next attack.
    fn plucks(
        rate: u32,
        attacks_ms: &[f64],
        seconds: f64,
        amplitude: f64,
        muted: bool,
    ) -> Vec<f32> {
        let total = (rate as f64 * seconds) as usize;
        (0..total)
            .map(|n| {
                let t = n as f64 / rate as f64 * 1000.0;
                let Some(index) = attacks_ms.iter().rposition(|&a| a <= t) else {
                    return 0.0;
                };
                let since = (t - attacks_ms[index]) / 1000.0;
                if muted
                    && attacks_ms
                        .get(index + 1)
                        .is_some_and(|&next| t > next - 80.0)
                {
                    return 0.0;
                }
                let phase = 2.0 * std::f64::consts::PI * 110.0 * since;
                (amplitude
                    * (-since / 0.25).exp()
                    * (phase.sin() + 0.5 * (2.0 * phase).sin() + 0.3 * (3.0 * phase).sin()))
                    as f32
            })
            .collect()
    }
    fn detected(rate: u32, samples: &[f32]) -> Vec<Onset> {
        let mut analyzer = Analyzer::new(rate, -55.0);
        let mut found = Vec::new();
        for (n, &sample) in samples.iter().enumerate() {
            analyzer.push(sample, n as u64);
            if n % (rate as usize / 15) == 0 {
                found.extend(analyzer.analyze().onsets);
            }
        }
        found.extend(analyzer.analyze().onsets);
        found
    }
    #[test]
    fn onsets_mark_each_pick_within_ten_milliseconds() {
        for rate in [44100, 48000, 96000] {
            for muted in [false, true] {
                let attacks = [100.0, 350.0, 600.0, 725.0, 850.0, 975.0];
                let found = detected(rate, &plucks(rate, &attacks, 1.3, 0.3, muted));
                assert_eq!(
                    found.len(),
                    attacks.len(),
                    "{rate} muted={muted}: {found:?}"
                );
                for (onset, attack) in found.iter().zip(attacks) {
                    assert!(
                        (onset.audio_time_ms - attack).abs() <= 10.0,
                        "{rate}: {} vs {attack}",
                        onset.audio_time_ms
                    );
                    assert!(onset.strength_db >= 9.0);
                }
            }
        }
    }
    #[test]
    fn steady_tones_quiet_input_and_double_triggers_do_not_add_onsets() {
        let rate = 48000;
        let steady: Vec<f32> = (0..rate)
            .map(|n| {
                (0.3 * (2.0 * std::f64::consts::PI * 220.0 * n as f64 / rate as f64).sin()) as f32
            })
            .collect();
        assert!(detected(rate, &steady).is_empty());
        assert!(detected(rate, &plucks(rate, &[100.0, 400.0], 0.8, 0.0003, false)).is_empty());
        assert_eq!(
            detected(rate, &plucks(rate, &[100.0, 125.0, 400.0], 0.8, 0.3, false)).len(),
            2
        );
    }
    #[test]
    fn a_discontinuity_drops_pending_onsets() {
        let rate = 48000;
        let mut analyzer = Analyzer::new(rate, -55.0);
        for (n, sample) in plucks(rate, &[100.0], 0.3, 0.3, false)
            .into_iter()
            .enumerate()
        {
            analyzer.push(sample, n as u64);
        }
        analyzer.push(0.1, 1_000_000);
        assert!(analyzer.analyze().onsets.is_empty());
    }
}
