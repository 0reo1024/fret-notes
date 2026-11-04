use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;
pub mod analysis;
mod buffer;
pub mod engine;
pub mod pitch;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    pub id: String,
    pub name: String,
    pub channels: Option<u16>,
    pub sample_rate: Option<u32>,
    pub is_default: bool,
}

pub fn input_devices() -> Result<Vec<InputDevice>, String> {
    let host = cpal::default_host();
    let default_id = host
        .default_input_device()
        .and_then(|d| d.id().ok())
        .map(|id| id.to_string());
    // An endpoint that is still appearing or disappearing can fail to report its id or name;
    // skip it rather than failing the whole list, and the next listing picks it up.
    Ok(host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter_map(|device| {
            let id = device.id().ok()?.to_string();
            let name = device.description().ok()?.name().to_string();
            let config = device.default_input_config().ok();
            Some(InputDevice {
                is_default: default_id.as_ref() == Some(&id),
                id,
                name,
                channels: config.as_ref().map(|c| c.channels()),
                sample_rate: config.as_ref().map(|c| c.sample_rate()),
            })
        })
        .collect())
}
