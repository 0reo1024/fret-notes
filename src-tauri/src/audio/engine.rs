use super::{
    analysis::{Analyzer, Signal, SignalState},
    buffer::SampleQueue,
};
use cpal::{
    traits::{DeviceTrait, HostTrait, StreamTrait},
    FromSample, Sample, SampleFormat, SizedSample,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StartRequest {
    pub session_id: String,
    pub device_id: Option<String>,
    pub channel: u16,
    pub gate_db: f64,
}
impl StartRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.session_id.is_empty()
            || self.session_id.len() > 64
            || !self
                .session_id
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || c == b'-')
            || self
                .device_id
                .as_ref()
                .is_some_and(|id| id.is_empty() || id.len() > 1024)
            || self.channel >= 64
            || !self.gate_db.is_finite()
            || !(-80.0..=-20.0).contains(&self.gate_db)
        {
            return Err("音声入力の設定が不正です".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    pub session_id: String,
    pub device_name: String,
    pub sample_rate: u32,
    pub analysis_sample_rate: f64,
    pub channels: u16,
    pub channel: u16,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub session_id: String,
    pub sequence: u64,
    pub audio_time_ms: f64,
    #[serde(flatten)]
    pub signal: Signal,
    pub dropped_samples: u64,
    pub message: Option<String>,
}
pub type ObservationSink = Arc<dyn Fn(Observation) -> bool + Send + Sync>;

/// At most one regular observation is awaiting a UI acknowledgement.
#[derive(Default)]
struct DeliveryGate {
    outstanding: AtomicU64,
    sequence: AtomicU64,
}
impl DeliveryGate {
    fn acquire(&self) -> Option<u64> {
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        self.outstanding
            .compare_exchange(0, sequence, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| sequence)
    }
    fn acknowledge(&self, sequence: u64) {
        let _ = self
            .outstanding
            .compare_exchange(sequence, 0, Ordering::AcqRel, Ordering::Acquire);
    }
}
enum Command {
    Start(
        StartRequest,
        ObservationSink,
        Arc<AtomicBool>,
        SyncSender<Result<Started, String>>,
    ),
    Stop(Option<String>, SyncSender<Result<(), String>>),
    Ack(String, u64),
    Shutdown,
}
struct Inner {
    suspended: Arc<AtomicBool>,
    sender: SyncSender<Command>,
    worker: Mutex<Option<JoinHandle<()>>>,
}
impl Drop for Inner {
    fn drop(&mut self) {
        let _ = self.sender.send(Command::Shutdown);
        if let Ok(worker) = self.worker.get_mut() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
    }
}
#[derive(Clone)]
pub struct AudioService {
    inner: Arc<Inner>,
}
pub struct StartTicket {
    receiver: Receiver<Result<Started, String>>,
    cancel: Arc<AtomicBool>,
}
impl StartTicket {
    pub fn wait(self) -> Result<Started, String> {
        match self.receiver.recv_timeout(Duration::from_secs(8)) {
            Ok(result) => result,
            Err(_) => {
                self.cancel.store(true, Ordering::Release);
                Err("音声入力の開始がタイムアウトしました".into())
            }
        }
    }
}
impl AudioService {
    pub fn new() -> Result<Self, String> {
        let (sender, receiver) = mpsc::sync_channel(16);
        let suspended = Arc::new(AtomicBool::new(false));
        let worker_suspended = suspended.clone();
        let worker = thread::Builder::new()
            .name("fret-audio-control".into())
            .spawn(move || control_loop(receiver, worker_suspended))
            .map_err(|e| e.to_string())?;
        Ok(Self {
            inner: Arc::new(Inner {
                suspended,
                sender,
                worker: Mutex::new(Some(worker)),
            }),
        })
    }
    pub fn begin_start(
        &self,
        request: StartRequest,
        sink: ObservationSink,
    ) -> Result<StartTicket, String> {
        request.validate()?;
        if self.inner.suspended.load(Ordering::Acquire) {
            return Err("ウィンドウを表示してから入力を開始してください".into());
        }
        let (sender, receiver) = mpsc::sync_channel(1);
        let cancel = Arc::new(AtomicBool::new(false));
        self.inner
            .sender
            .try_send(Command::Start(request, sink, cancel.clone(), sender))
            .map_err(|_| "音声処理が混み合っています。もう一度お試しください".to_string())?;
        Ok(StartTicket { receiver, cancel })
    }
    pub fn begin_stop(
        &self,
        session_id: Option<String>,
    ) -> Result<Receiver<Result<(), String>>, String> {
        let (sender, receiver) = mpsc::sync_channel(1);
        self.inner
            .sender
            .try_send(Command::Stop(session_id, sender))
            .map_err(|_| "音声停止を要求できません".to_string())?;
        Ok(receiver)
    }
    pub fn stop(&self, session_id: Option<String>) -> Result<(), String> {
        self.begin_stop(session_id)?
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "音声停止がタイムアウトしました".to_string())?
    }
    pub fn acknowledge(&self, session_id: String, sequence: u64) -> Result<(), String> {
        self.inner
            .sender
            .try_send(Command::Ack(session_id, sequence))
            .map_err(|_| "音声通知を確認できません".into())
    }
    pub fn set_suspended(&self, suspended: bool) {
        self.inner.suspended.store(suspended, Ordering::Release);
        if suspended {
            let _ = self.begin_stop(None);
        }
    }
}
fn control_loop(receiver: Receiver<Command>, suspended: Arc<AtomicBool>) {
    let mut active: Option<ActiveSession> = None;
    let mut canceled: VecDeque<String> = VecDeque::with_capacity(16);
    let mut last_tick = Instant::now();
    loop {
        if last_tick.elapsed() > Duration::from_secs(1) {
            if let Some(session) = &active {
                session.fail("入力が中断されました。もう一度開始してください".into());
            }
        }
        last_tick = Instant::now();
        if active
            .as_ref()
            .is_some_and(|s| s.stop.load(Ordering::Acquire))
        {
            let session = active.take().unwrap();
            let message = session.error.lock().ok().and_then(|e| e.clone());
            if message.is_some() {
                session.finish(SignalState::Error, message);
            } else {
                session.close();
            }
        }
        let command = if active.is_some() {
            receiver.recv_timeout(Duration::from_millis(20))
        } else {
            receiver
                .recv()
                .map_err(|_| mpsc::RecvTimeoutError::Disconnected)
        };
        match command {
            Ok(Command::Start(request, sink, cancel, reply)) => {
                let result = if suspended.load(Ordering::Acquire)
                    || canceled.contains(&request.session_id)
                    || cancel.load(Ordering::Acquire)
                {
                    Err("音声入力の開始を取り消しました".into())
                } else if active.is_some() {
                    Err("音声入力はすでに使用中です。停止してから開始してください".into())
                } else {
                    ActiveSession::open(request, sink, cancel).and_then(|(session, info)| {
                        if suspended.load(Ordering::Acquire) {
                            session.close();
                            Err("ウィンドウを表示してから入力を開始してください".into())
                        } else {
                            active = Some(session);
                            Ok(info)
                        }
                    })
                };
                let _ = reply.send(result);
                last_tick = Instant::now();
            }
            Ok(Command::Stop(id, reply)) => {
                if let Some(id) = &id {
                    if canceled.len() == 16 {
                        canceled.pop_front();
                    }
                    canceled.push_back(id.clone());
                }
                if active
                    .as_ref()
                    .is_some_and(|s| id.as_ref().is_none_or(|id| id == &s.id))
                {
                    active.take().unwrap().finish(SignalState::Stopped, None);
                }
                let _ = reply.send(Ok(()));
                last_tick = Instant::now();
            }
            Ok(Command::Ack(id, sequence)) => {
                if let Some(session) = &active {
                    if session.id == id {
                        session.gate.acknowledge(sequence);
                    }
                }
            }
            Ok(Command::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                if let Some(session) = active.take() {
                    session.close();
                }
                break;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    }
}
struct ActiveSession {
    audio_time: Arc<AtomicU64>,
    id: String,
    stream: cpal::Stream,
    analyzer: JoinHandle<()>,
    stop: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    gate: Arc<DeliveryGate>,
    sink: ObservationSink,
}
impl ActiveSession {
    fn open(
        request: StartRequest,
        sink: ObservationSink,
        stop: Arc<AtomicBool>,
    ) -> Result<(Self, Started), String> {
        let host = cpal::default_host();
        let device = if let Some(id) = &request.device_id {
            host.input_devices()
                .map_err(|e| e.to_string())?
                .find(|d| d.id().is_ok_and(|device| device.to_string() == *id))
                .ok_or("入力デバイスが見つかりません。接続を確認して一覧を更新してください")?
        } else {
            host.default_input_device()
                .ok_or("Windowsの既定入力がありません")?
        };
        let supported = device
            .default_input_config()
            .map_err(|e| format!("入力形式を取得できません: {e}"))?;
        let config = supported.config();
        let rate = config.sample_rate;
        if config.channels == 0
            || config.channels > 64
            || request.channel >= config.channels
            || !(8000..=192000).contains(&rate)
        {
            return Err("入力チャンネルまたはサンプルレートに対応していません".into());
        }
        let name = device
            .description()
            .map_err(|e| e.to_string())?
            .name()
            .to_string();
        let queue = Arc::new(SampleQueue::new(32768));
        let dropped = Arc::new(AtomicU64::new(0));
        let error = Arc::new(Mutex::new(None));
        let gate = Arc::new(DeliveryGate::default());
        macro_rules! build {
            ($ty:ty) => {
                input_stream::<$ty>(
                    &device,
                    config.clone(),
                    request.channel,
                    queue.clone(),
                    dropped.clone(),
                    stop.clone(),
                    error.clone(),
                )
            };
        }
        let stream = match supported.sample_format() {
            SampleFormat::F32 => build!(f32), SampleFormat::F64 => build!(f64), SampleFormat::I8 => build!(i8), SampleFormat::I16 => build!(i16), SampleFormat::I24 => build!(cpal::I24), SampleFormat::I32 => build!(i32), SampleFormat::I64 => build!(i64), SampleFormat::U8 => build!(u8), SampleFormat::U16 => build!(u16), SampleFormat::U24 => build!(cpal::U24), SampleFormat::U32 => build!(u32), SampleFormat::U64 => build!(u64), _ => return Err("この音声サンプル形式には対応していません".into()),
        }.map_err(|e| format!("入力を開けません。接続・他のアプリ・Windowsのマイクアクセス設定を確認してください: {e}"))?;
        if stop.load(Ordering::Acquire) {
            return Err("音声入力の開始を取り消しました".into());
        }
        let analyzer = Analyzer::new(rate, request.gate_db);
        let analysis_rate = analyzer.analysis_rate;
        stream
            .play()
            .map_err(|e| format!("入力を開始できません: {e}"))?;
        let session_id = request.session_id.clone();
        let analyzer_stop = stop.clone();
        let analyzer_error = error.clone();
        let analyzer_sink = sink.clone();
        let analyzer_gate = gate.clone();
        let audio_time = Arc::new(AtomicU64::new(0.0_f64.to_bits()));
        let analyzer_time = audio_time.clone();
        let thread = thread::Builder::new()
            .name("fret-pitch-analysis".into())
            .spawn(move || {
                analyze_loop(
                    analyzer,
                    queue,
                    dropped,
                    session_id,
                    analyzer_stop,
                    analyzer_error,
                    analyzer_gate,
                    analyzer_sink,
                    analyzer_time,
                )
            })
            .map_err(|e| e.to_string())?;
        let info = Started {
            session_id: request.session_id.clone(),
            device_name: name,
            sample_rate: rate,
            analysis_sample_rate: analysis_rate,
            channels: config.channels,
            channel: request.channel,
        };
        Ok((
            Self {
                id: request.session_id,
                stream,
                analyzer: thread,
                stop,
                error,
                gate,
                sink,
                audio_time,
            },
            info,
        ))
    }
    fn fail(&self, message: String) {
        if let Ok(mut error) = self.error.lock() {
            *error = Some(message);
        }
        self.stop.store(true, Ordering::Release);
    }
    fn close(self) {
        self.stop.store(true, Ordering::Release);
        drop(self.stream);
        let _ = self.analyzer.join();
    }
    fn finish(self, state: SignalState, message: Option<String>) {
        let sink = self.sink.clone();
        let id = self.id.clone();
        let gate = self.gate.clone();
        let time = self.audio_time.clone();
        self.close();
        // Assign the final sequence after joining, so analysis cannot race a
        // terminal notification with one more successful pitch.
        let sequence = gate.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        sink(Observation {
            session_id: id,
            sequence,
            audio_time_ms: f64::from_bits(time.load(Ordering::Acquire)),
            signal: Signal::empty(state),
            dropped_samples: 0,
            message,
        });
    }
}
fn input_stream<T: SizedSample + Sample>(
    device: &cpal::Device,
    config: cpal::StreamConfig,
    channel: u16,
    queue: Arc<SampleQueue>,
    dropped: Arc<AtomicU64>,
    stop: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
) -> Result<cpal::Stream, cpal::Error>
where
    f32: FromSample<T>,
{
    let channels = config.channels as usize;
    let rate = config.sample_rate as f64;
    let callback_stop = stop.clone();
    let mut next_frame = 0_u64;
    let mut origin: Option<cpal::StreamInstant> = None;
    device.build_input_stream(
        config,
        move |data: &[T], info: &cpal::InputCallbackInfo| {
            if callback_stop.load(Ordering::Relaxed) {
                return;
            }
            let capture = info.timestamp().capture;
            let start = *origin.get_or_insert(capture);
            let clock_frame = (capture.duration_since(start).as_secs_f64() * rate).round() as u64;
            next_frame = next_frame.max(clock_frame);
            // No allocation, lock, IPC, file access or pitch estimation in this callback.
            for frame in data.chunks_exact(channels) {
                if !queue.push(frame[channel as usize].to_sample::<f32>(), next_frame) {
                    dropped.fetch_add(1, Ordering::Relaxed);
                }
                next_frame = next_frame.saturating_add(1);
            }
        },
        move |err| {
            if let Ok(mut message) = error.lock() {
                *message = Some(format!("音声入力が切断・中断されました: {err}"));
            }
            stop.store(true, Ordering::Release);
        },
        Some(Duration::from_secs(2)),
    )
}
fn analyze_loop(
    mut analyzer: Analyzer,
    queue: Arc<SampleQueue>,
    dropped: Arc<AtomicU64>,
    session_id: String,
    stop: Arc<AtomicBool>,
    error: Arc<Mutex<Option<String>>>,
    gate: Arc<DeliveryGate>,
    sink: ObservationSink,
    audio_time: Arc<AtomicU64>,
) {
    let mut last_input = Instant::now();
    let mut last_send = Instant::now();
    let mut last_ack = Instant::now();
    let mut last_dropped = 0;
    let mut starving = false;
    while !stop.load(Ordering::Acquire) {
        let mut received = false;
        for _ in 0..32768 {
            let Some((sample, frame)) = queue.pop() else {
                break;
            };
            received = true;
            analyzer.push(sample, frame);
        }
        if received {
            last_input = Instant::now();
            audio_time.store(analyzer.audio_time_ms().to_bits(), Ordering::Release);
            starving = false;
        }
        if !starving && last_input.elapsed() > Duration::from_millis(250) {
            analyzer.reset();
            starving = true;
        }
        let total_dropped = dropped.load(Ordering::Acquire);
        let overflow = total_dropped != last_dropped;
        if overflow {
            analyzer.reset();
            last_dropped = total_dropped;
        }
        if gate.outstanding.load(Ordering::Acquire) == 0 {
            last_ack = Instant::now();
        }
        let failure = if last_input.elapsed() > Duration::from_secs(1) {
            Some("入力データが途切れました。接続を確認して再開始してください")
        } else if last_ack.elapsed() > Duration::from_secs(2) {
            Some("画面への通知が中断されたため、音声入力を停止しました")
        } else {
            None
        };
        if let Some(message) = failure {
            if let Ok(mut error) = error.lock() {
                *error = Some(message.into());
            }
            stop.store(true, Ordering::Release);
            break;
        }
        if last_send.elapsed() >= Duration::from_millis(67) {
            let signal = if overflow || starving {
                Signal::empty(SignalState::Unstable)
            } else {
                analyzer.analyze()
            };
            if let Some(sequence) = gate.acquire() {
                if !sink(Observation {
                    session_id: session_id.clone(),
                    sequence,
                    audio_time_ms: analyzer.audio_time_ms(),
                    signal,
                    dropped_samples: total_dropped,
                    message: if starving {
                        Some("入力データを待っています".into())
                    } else if overflow {
                        Some("入力処理が遅れたため再検出しています".into())
                    } else {
                        None
                    },
                }) {
                    stop.store(true, Ordering::Release);
                    break;
                }
            }
            last_send = Instant::now();
        }
        thread::sleep(Duration::from_millis(5));
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_backpressure_and_request_validation() {
        let gate = DeliveryGate::default();
        let first = gate.acquire().unwrap();
        assert!(gate.acquire().is_none());
        gate.acknowledge(first + 1);
        assert!(gate.acquire().is_none());
        gate.acknowledge(first);
        assert!(gate.acquire().is_some());
        let mut request = StartRequest {
            session_id: "test-session".into(),
            device_id: None,
            channel: 0,
            gate_db: -55.0,
        };
        assert!(request.validate().is_ok());
        request.channel = 64;
        assert!(request.validate().is_err());
        request.channel = 0;
        request.gate_db = f64::NAN;
        assert!(request.validate().is_err());
    }
    #[test]
    fn stop_before_start_cancels_and_unmatched_stop_is_safe() {
        let service = AudioService::new().unwrap();
        service.set_suspended(true);
        assert!(service
            .begin_start(
                StartRequest {
                    session_id: "suspended".into(),
                    device_id: None,
                    channel: 0,
                    gate_db: -55.0
                },
                Arc::new(|_| true)
            )
            .is_err());
        service.set_suspended(false);
        service.stop(Some("canceled".into())).unwrap();
        let ticket = service
            .begin_start(
                StartRequest {
                    session_id: "canceled".into(),
                    device_id: None,
                    channel: 0,
                    gate_db: -55.0,
                },
                Arc::new(|_| true),
            )
            .unwrap();
        assert!(ticket.wait().unwrap_err().contains("取り消"));
        service.stop(Some("other".into())).unwrap();
    }
    #[test]
    fn missing_samples_clear_pitch_and_stop_the_analysis_worker() {
        let queue = Arc::new(SampleQueue::new(32768));
        for n in 0..32768 {
            queue.push(
                (0.3 * (2.0 * std::f64::consts::PI * 110.0 * n as f64 / 48000.0).sin()) as f32,
                n,
            );
        }
        let stop = Arc::new(AtomicBool::new(false));
        let error = Arc::new(Mutex::new(None));
        let gate = Arc::new(DeliveryGate::default());
        let received = Arc::new(Mutex::new(Vec::new()));
        let output = received.clone();
        let acknowledge = gate.clone();
        analyze_loop(
            Analyzer::new(48000, -55.0),
            queue,
            Arc::new(AtomicU64::new(0)),
            "missing-samples".into(),
            stop.clone(),
            error.clone(),
            gate,
            Arc::new(move |observation| {
                acknowledge.acknowledge(observation.sequence);
                output.lock().unwrap().push(observation);
                true
            }),
            Arc::new(AtomicU64::new(0.0_f64.to_bits())),
        );
        assert!(stop.load(Ordering::Acquire));
        assert!(error.lock().unwrap().as_ref().unwrap().contains("途切れ"));
        let observations = received.lock().unwrap();
        assert!(observations.len() > 3);
        assert!(observations.last().unwrap().signal.frequency.is_none());
    }
}
