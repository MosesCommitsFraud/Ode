use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{Device, Host};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    /// Sieht nach einem virtuellen Kabel aus (VB-Cable, VAC).
    pub is_virtual_cable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct DeviceList {
    pub inputs: Vec<DeviceInfo>,
    pub outputs: Vec<DeviceInfo>,
}

pub fn is_virtual_cable(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    ["cable", "vb-audio", "virtual audio cable", "line 1"]
        .iter()
        .any(|needle| name.contains(needle))
}

fn device_name(device: &Device) -> String {
    device
        .description()
        .map(|d| d.name().to_string())
        .unwrap_or_else(|_| crate::tr!("Unbekanntes Gerät", "Unknown device"))
}

fn device_id(device: &Device) -> Option<String> {
    device.id().ok().map(|id| id.to_string())
}

fn describe(device: &Device, default_id: &Option<String>) -> Option<DeviceInfo> {
    let id = device_id(device)?;
    let name = device_name(device);
    Some(DeviceInfo {
        is_default: default_id.as_deref() == Some(id.as_str()),
        is_virtual_cable: is_virtual_cable(&name),
        id,
        name,
    })
}

pub fn list(host: &Host) -> anyhow::Result<DeviceList> {
    let default_in = host.default_input_device().as_ref().and_then(device_id);
    let default_out = host.default_output_device().as_ref().and_then(device_id);

    let inputs = host
        .input_devices()?
        .filter_map(|d| describe(&d, &default_in))
        .collect();
    let outputs = host
        .output_devices()?
        .filter_map(|d| describe(&d, &default_out))
        .collect();

    Ok(DeviceList { inputs, outputs })
}

pub fn find(host: &Host, id: &str) -> anyhow::Result<Device> {
    let parsed: cpal::DeviceId = id.parse().map_err(|_| {
        anyhow::anyhow!(crate::tr!(
            "Ungültige Geräte-ID: {id}",
            "Invalid device ID: {id}"
        ))
    })?;
    host.device_by_id(&parsed).ok_or_else(|| {
        anyhow::anyhow!(crate::tr!(
            "Gerät nicht gefunden: {id}",
            "Device not found: {id}"
        ))
    })
}

pub fn name_of(device: &Device) -> String {
    device_name(device)
}

pub fn id_of(device: &Device) -> Option<String> {
    device_id(device)
}
