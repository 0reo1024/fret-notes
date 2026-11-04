use fret_notes_lib::audio::{
    analysis::SignalState,
    engine::{AudioService, Observation, StartRequest},
};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().collect();
    let argument = |name: &str| {
        args.iter()
            .position(|value| value == name)
            .and_then(|n| args.get(n + 1))
            .cloned()
    };
    let device_id = argument("--device").ok_or("--device に入力デバイスIDを指定してください")?;
    let channel: u16 = argument("--channel")
        .unwrap_or("0".into())
        .parse()
        .map_err(|_| "channel")?;
    let seconds: u64 = argument("--seconds")
        .unwrap_or("10".into())
        .parse()
        .map_err(|_| "seconds")?;
    if !(1..=30).contains(&seconds) {
        return Err("検証は1〜30秒です".into());
    }
    let service = AudioService::new()?;
    let observations: Arc<Mutex<Vec<Observation>>> = Arc::new(Mutex::new(Vec::with_capacity(500)));
    let received = observations.clone();
    let acknowledge = service.clone();
    let skip_ack = args.iter().any(|arg| arg == "--no-ack");
    let request = StartRequest {
        session_id: "live-probe".into(),
        device_id: Some(device_id),
        channel,
        gate_db: -55.0,
    };
    let ticket = service.begin_start(
        request,
        Arc::new(move |observation| {
            if !skip_ack {
                let _ =
                    acknowledge.acknowledge(observation.session_id.clone(), observation.sequence);
            }
            if let Ok(mut received) = received.lock() {
                if received.len() < 500 {
                    received.push(observation);
                }
            }
            true
        }),
    )?;
    let started = ticket.wait()?;
    eprintln!(
        "Input started: {} channel {} · {} Hz · {} seconds",
        started.device_name,
        channel + 1,
        started.sample_rate,
        seconds
    );
    let begin = Instant::now();
    std::thread::sleep(Duration::from_secs(seconds));
    service.stop(Some("live-probe".into()))?;
    let observations = observations.lock().map_err(|e| e.to_string())?;
    let mut counts = BTreeMap::new();
    let mut notes = BTreeMap::new();
    let mut frequencies: Vec<f64> = Vec::new();
    for observation in observations.iter() {
        *counts
            .entry(format!("{:?}", observation.signal.state))
            .or_insert(0_u32) += 1;
        if let Some(frequency) = observation.signal.frequency {
            frequencies.push(frequency);
            let midi = (69.0 + 12.0 * (frequency / 440.0).log2()).round() as i32;
            *notes.entry(midi).or_insert(0_u32) += 1;
        }
    }
    frequencies.sort_by(f64::total_cmp);
    let report = serde_json::json!({"started":started,"durationMs":begin.elapsed().as_secs_f64()*1000.0,"observations":observations.len(),"states":counts,"detectedMidi":notes,"medianFrequency":frequencies.get(frequencies.len()/2),"firstStableAudioTimeMs":observations.iter().find(|o|o.signal.state==SignalState::Stable).map(|o|o.audio_time_ms),"maximumDroppedSamples":observations.iter().map(|o|o.dropped_samples).max(),"errors":observations.iter().filter(|o|o.signal.state==SignalState::Error).map(|o|o.message.clone()).collect::<Vec<_>>(),"onsets":observations.iter().map(|o|o.signal.onsets.len()).sum::<usize>(),"timeline":observations.iter().map(|o|serde_json::json!({"audioTimeMs":o.audio_time_ms,"state":o.signal.state,"frequency":o.signal.frequency,"levelDb":o.signal.level_db,"onsets":o.signal.onsets})).collect::<Vec<_>>()});
    if let Some(path) = argument("--report") {
        std::fs::write(
            path,
            serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    let mut compact = report.clone();
    compact.as_object_mut().unwrap().remove("timeline");
    println!("{}", serde_json::to_string_pretty(&compact).unwrap());
    Ok(())
}
