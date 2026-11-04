/// YIN pitch estimate. The streaming analyzer supplies filtering, gating and
/// stability checks. This function runs outside the audio callback.
#[derive(Debug)]
pub struct Estimate {
    pub frequency: f64,
    pub confidence: f64,
}

pub fn estimate(samples: &[f32], sample_rate: f64, minimum: f64, maximum: f64) -> Option<Estimate> {
    if !sample_rate.is_finite()
        || !minimum.is_finite()
        || !maximum.is_finite()
        || minimum <= 0.0
        || maximum <= minimum
        || maximum >= sample_rate / 2.0
    {
        return None;
    }
    let max_lag = (sample_rate / minimum).ceil() as usize;
    let min_lag = (sample_rate / maximum).floor().max(2.0) as usize;
    if samples.len() < max_lag.saturating_mul(2) || samples.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let mean = samples.iter().map(|&v| v as f64).sum::<f64>() / samples.len() as f64;
    let variance = samples
        .iter()
        .map(|&v| (v as f64 - mean).powi(2))
        .sum::<f64>()
        / samples.len() as f64;
    if variance < 1e-12 {
        return None;
    }
    let length = samples.len() - max_lag;
    let mut difference = vec![0.0; max_lag + 1];
    let mut normalized = vec![1.0; max_lag + 1];
    let mut sum = 0.0;
    for lag in 1..=max_lag {
        difference[lag] = (0..length)
            .map(|i| (samples[i] as f64 - samples[i + lag] as f64).powi(2))
            .sum();
        sum += difference[lag];
        normalized[lag] = if sum > 0.0 {
            difference[lag] * lag as f64 / sum
        } else {
            1.0
        };
    }
    let mut lag = min_lag;
    while lag < max_lag {
        if normalized[lag] < 0.15 {
            while lag < max_lag && normalized[lag + 1] < normalized[lag] {
                lag += 1;
            }
            if lag >= max_lag {
                return None;
            }
            let refine = |index: usize| {
                let (left, center, right) = (
                    difference[index - 1],
                    difference[index],
                    difference[index + 1],
                );
                let denominator = left - 2.0 * center + right;
                let offset = if denominator > 1e-12 {
                    (0.5 * (left - right) / denominator).clamp(-1.0, 1.0)
                } else {
                    0.0
                };
                let refined = index as f64 + offset;
                let whole = refined.floor() as usize;
                let fraction = refined - whole as f64;
                let weights = [
                    -fraction * (fraction - 1.0) * (fraction - 2.0) / 6.0,
                    (fraction + 1.0) * (fraction - 1.0) * (fraction - 2.0) / 2.0,
                    -(fraction + 1.0) * fraction * (fraction - 2.0) / 2.0,
                    (fraction + 1.0) * fraction * (fraction - 1.0) / 6.0,
                ];
                let evaluation_length = length - 2;
                let fractional_difference = (0..evaluation_length)
                    .map(|i| {
                        let shifted = (0..4)
                            .map(|j| weights[j] * samples[i + whole + j - 1] as f64)
                            .sum::<f64>();
                        (samples[i] as f64 - shifted).powi(2)
                    })
                    .sum::<f64>();
                (
                    refined,
                    (fractional_difference / (2.0 * variance * evaluation_length as f64))
                        .clamp(0.0, 1.0),
                )
            };
            let (base_lag, base_depth) = refine(lag);
            let (mut refined, mut depth) = (base_lag, base_depth);
            // A strong overtone can reach the YIN threshold before its weak
            // fundamental. Compare harmonic periods by interpolated depth;
            // interpolation prevents rounding error in pure high notes from
            // being mistaken for evidence of a lower fundamental.
            if base_depth > 0.002 {
                for multiple in 2..=4 {
                    let expected = (base_lag * multiple as f64).round() as usize;
                    for candidate in expected.saturating_sub(2).max(min_lag)
                        ..=expected.saturating_add(2).min(max_lag - 1)
                    {
                        if normalized[candidate] > normalized[candidate - 1]
                            || normalized[candidate] > normalized[candidate + 1]
                        {
                            continue;
                        }
                        let (candidate_lag, candidate_depth) = refine(candidate);
                        if candidate_depth < base_depth * 0.25
                            && candidate_depth < depth
                            && (candidate_lag / (base_lag * multiple as f64) - 1.0).abs() < 0.02
                        {
                            refined = candidate_lag;
                            depth = candidate_depth;
                        }
                    }
                }
            }
            let frequency = sample_rate / refined;
            return if frequency >= minimum && frequency <= maximum {
                Some(Estimate {
                    frequency,
                    confidence: (1.0 - depth).clamp(0.0, 1.0),
                })
            } else {
                None
            };
        }
        lag += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dominant_harmonics_do_not_replace_the_fundamental() {
        let rate = 12000.0;
        for frequency in [30.8677, 82.4069, 110.0, 329.6276] {
            let samples: Vec<f32> = (0..4096)
                .map(|n| {
                    let p = 2.0 * std::f64::consts::PI * frequency * n as f64 / rate;
                    (0.02 * p.sin() + 0.35 * (3.0 * p).sin()) as f32
                })
                .collect();
            let estimate = estimate(&samples, rate, 25.0, 1500.0).unwrap();
            assert!(
                (1200.0 * (estimate.frequency / frequency).log2()).abs() < 5.0,
                "{frequency}: {}",
                estimate.frequency
            );
        }
    }
    #[test]
    fn pure_notes_do_not_shift_to_a_subharmonic() {
        for frequency in [
            27.5, 41.2034, 82.4069, 110.0, 329.6276, 440.0, 659.2551, 1000.0, 1470.0,
        ] {
            let samples: Vec<f32> = (0..4096)
                .map(|n| {
                    (0.3 * (2.0 * std::f64::consts::PI * frequency * n as f64 / 12000.0).sin())
                        as f32
                })
                .collect();
            let detected = estimate(&samples, 12000.0, 25.0, 1500.0).unwrap();
            assert!(
                (1200.0 * (detected.frequency / frequency).log2()).abs() < 6.0,
                "{frequency}: {}",
                detected.frequency
            );
        }
    }
    #[test]
    fn detects_low_bass_and_guitar_with_harmonics_and_dc_offset() {
        let sample_rate = 12000.0;
        for frequency in [30.8677, 41.2034, 82.4069, 110.0, 329.6276, 440.0] {
            let samples: Vec<f32> = (0..4096)
                .map(|i| {
                    let phase = 2.0 * std::f64::consts::PI * frequency * i as f64 / sample_rate;
                    (0.3 * phase.sin()
                        + 0.2 * (2.0 * phase).sin()
                        + 0.12 * (3.0 * phase).sin()
                        + 0.08) as f32
                })
                .collect();
            let result = estimate(&samples, sample_rate, 25.0, 1000.0).unwrap();
            let cents = 1200.0 * (result.frequency / frequency).log2();
            assert!(cents.abs() < 5.0, "{frequency}: {cents} cents");
            assert!(result.confidence > 0.95);
        }
    }
    #[test]
    fn rejects_silence_invalid_data_and_short_windows() {
        assert!(estimate(&[0.0; 4096], 12000.0, 25.0, 1000.0).is_none());
        assert!(estimate(&[0.1; 4096], 12000.0, 25.0, 1000.0).is_none());
        assert!(estimate(&[f32::NAN; 4096], 12000.0, 25.0, 1000.0).is_none());
        assert!(estimate(&[0.2; 10], 12000.0, 25.0, 1000.0).is_none());
        assert!(estimate(&[0.2; 4096], 12000.0, 0.0, 1000.0).is_none());
    }
}
