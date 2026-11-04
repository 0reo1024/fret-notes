pub mod audio;
pub mod storage;
pub mod training;
use audio::engine::{AudioService, Observation, StartRequest, Started};
use storage::{LoadedSettings, Settings, SettingsStore};
use tauri::Manager;
use training::{LoadedTraining, TrainingStore};

#[tauri::command]
fn load_settings(store: tauri::State<'_, SettingsStore>) -> Result<LoadedSettings, String> {
    store.load()
}

#[tauri::command]
fn save_settings(settings: Settings, store: tauri::State<'_, SettingsStore>) -> Result<(), String> {
    store.save(&settings)
}

#[tauri::command]
fn load_training_data(store: tauri::State<'_, TrainingStore>) -> Result<LoadedTraining, String> {
    store.load()
}

#[tauri::command]
fn save_training_data(
    data: serde_json::Value,
    store: tauri::State<'_, TrainingStore>,
) -> Result<(), String> {
    store.save(&data)
}

#[tauri::command]
async fn list_input_devices() -> Result<Vec<audio::InputDevice>, String> {
    tauri::async_runtime::spawn_blocking(audio::input_devices)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn start_audio(
    request: StartRequest,
    on_event: tauri::ipc::Channel<Observation>,
    service: tauri::State<'_, AudioService>,
) -> Result<Started, String> {
    let ticket = service.begin_start(
        request,
        std::sync::Arc::new(move |observation| on_event.send(observation).is_ok()),
    )?;
    tauri::async_runtime::spawn_blocking(move || ticket.wait())
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn stop_audio(
    session_id: Option<String>,
    service: tauri::State<'_, AudioService>,
) -> Result<(), String> {
    let response = service.begin_stop(session_id)?;
    tauri::async_runtime::spawn_blocking(move || {
        response
            .recv_timeout(std::time::Duration::from_secs(8))
            .map_err(|_| "音声停止がタイムアウトしました".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn ack_audio(
    session_id: String,
    sequence: u64,
    service: tauri::State<'_, AudioService>,
) -> Result<(), String> {
    service.acknowledge(session_id, sequence)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(SettingsStore::new(app.path().app_data_dir()?));
            app.manage(TrainingStore::new(app.path().app_data_dir()?));
            app.manage(AudioService::new().map_err(std::io::Error::other)?);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                let Some(service) = window.try_state::<AudioService>() else {
                    return;
                };
                match event {
                    tauri::WindowEvent::Resized(_) => {
                        service.set_suspended(window.is_minimized().unwrap_or(false))
                    }
                    tauri::WindowEvent::Destroyed => service.set_suspended(true),
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            load_training_data,
            save_training_data,
            list_input_devices,
            start_audio,
            stop_audio,
            ack_audio
        ])
        .build(tauri::generate_context!())
        .expect("Fret Notes could not start")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
            ) {
                let _ = app.state::<AudioService>().stop(None);
            }
        });
}
