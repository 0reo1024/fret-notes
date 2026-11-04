use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::PathBuf,
    sync::Mutex,
};

const SCHEMA_VERSION: u32 = 3;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AudioSettings {
    pub device_id: Option<String>,
    pub channel: u16,
    pub reference_hz: f64,
    pub gate_db: f64,
}
impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            device_id: None,
            channel: 0,
            reference_hz: 440.0,
            gate_db: -55.0,
        }
    }
}
impl AudioSettings {
    fn validate(&self) -> Result<(), String> {
        if self
            .device_id
            .as_ref()
            .is_some_and(|id| id.is_empty() || id.len() > 1024)
            || self.channel >= 64
            || !self.reference_hz.is_finite()
            || !(400.0..=480.0).contains(&self.reference_hz)
            || !self.gate_db.is_finite()
            || !(-80.0..=-20.0).contains(&self.gate_db)
        {
            return Err("音声入力の設定が不正です".into());
        }
        Ok(())
    }
}
const INSTRUMENT_IDS: [&str; 3] = ["guitar", "bass4", "bass5"];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TuningPreset {
    id: String,
    name: String,
    instrument_id: String,
    open_midi: Vec<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TuningConfig {
    selected_tuning_id: String,
    custom_tunings: Vec<TuningPreset>,
}

impl Default for TuningConfig {
    fn default() -> Self {
        Self {
            selected_tuning_id: "standard".into(),
            custom_tunings: Vec::new(),
        }
    }
}

impl TuningConfig {
    fn validate(&self, instrument: &str) -> Result<(), String> {
        let count = match instrument {
            "guitar" => 6,
            "bass4" => 4,
            "bass5" => 5,
            _ => return Err("未対応の楽器です".into()),
        };
        if self.custom_tunings.len() > 12 {
            return Err("チューニングは楽器ごとに12件までです".into());
        }
        let mut ids = BTreeSet::new();
        for tuning in &self.custom_tunings {
            let valid_id = tuning.id.strip_prefix("user:").is_some_and(|id| {
                !id.is_empty()
                    && id.len() <= 64
                    && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            });
            if !valid_id
                || !ids.insert(tuning.id.as_str())
                || tuning.instrument_id != instrument
                || tuning.name.trim().is_empty()
                || tuning.name.chars().count() > 40
                || tuning.name.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
                || tuning.open_midi.len() != count
                || tuning.open_midi.iter().any(|midi| *midi > 115)
            {
                return Err("チューニングの名前・弦数・音高が不正です".into());
            }
        }
        let drop = if instrument == "bass5" {
            "drop-a"
        } else {
            "drop-d"
        };
        let fourths = instrument == "guitar" && self.selected_tuning_id == "all-fourths";
        if !["standard", "half-step-down", drop].contains(&self.selected_tuning_id.as_str())
            && !fourths
            && !ids.contains(self.selected_tuning_id.as_str())
        {
            return Err("選択中のチューニングが見つかりません".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlayOptions {
    tolerance_cents: u16,
    hold_ms: u16,
}

impl Default for PlayOptions {
    fn default() -> Self {
        Self {
            tolerance_cents: 10,
            hold_ms: 350,
        }
    }
}

impl PlayOptions {
    fn validate(&self) -> Result<(), String> {
        if ![5, 10, 20].contains(&self.tolerance_cents) || ![200, 350, 500].contains(&self.hold_ms)
        {
            return Err("入力設定が不正です".into());
        }
        Ok(())
    }
}

/// Performance practice range and tuning, kept apart from the study profile.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlaySettings {
    strings: Vec<u8>,
    frets: Vec<u8>,
    natural_only: bool,
    tuning: TuningConfig,
}

impl PlaySettings {
    fn validate(&self, instrument: &str) -> Result<(), String> {
        self.tuning.validate(instrument)?;
        let count = match instrument {
            "guitar" => 6,
            "bass4" => 4,
            _ => 5,
        };
        if self.strings.len() > count as usize
            || self.strings.iter().any(|n| *n < 1 || *n > count)
            || self.frets.len() > 13
            || self.frets.iter().any(|n| *n > 12)
        {
            return Err("演奏練習の範囲が不正です".into());
        }
        Ok(())
    }
}

fn default_instruments() -> BTreeMap<String, TuningConfig> {
    INSTRUMENT_IDS
        .into_iter()
        .map(|id| (id.into(), TuningConfig::default()))
        .collect()
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub schema_version: u32,
    pub last_instrument: String,
    pub bass_string_count: u8,
    pub profiles: BTreeMap<String, Value>,
    #[serde(default)]
    pub instruments: BTreeMap<String, TuningConfig>,
    #[serde(default)]
    pub audio: Option<AudioSettings>,
    #[serde(default)]
    pub play: BTreeMap<String, PlaySettings>,
    #[serde(default)]
    pub play_options: PlayOptions,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            last_instrument: "guitar".into(),
            bass_string_count: 4,
            profiles: BTreeMap::new(),
            instruments: default_instruments(),
            audio: Some(AudioSettings::default()),
            play: BTreeMap::new(),
            play_options: PlayOptions::default(),
        }
    }
}

impl Settings {
    fn migrate(mut self) -> Result<Self, String> {
        if self.schema_version == 1 {
            if !self.instruments.is_empty() {
                return Err("旧バージョンの設定に未対応の項目があります".into());
            }
            self.instruments = default_instruments();
            self.schema_version = 2;
        }
        if self.schema_version == 2 {
            if self.audio.is_some() {
                return Err("旧バージョンの設定に未対応の項目があります".into());
            }
            self.audio = Some(AudioSettings::default());
            self.schema_version = SCHEMA_VERSION;
        }
        self.validate()?;
        Ok(self)
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.schema_version != SCHEMA_VERSION {
            return Err("未対応の設定ファイルのバージョンです".into());
        }
        self.audio
            .as_ref()
            .ok_or("音声入力の設定がありません")?
            .validate()?;
        if !["guitar", "bass4", "bass5"].contains(&self.last_instrument.as_str())
            || ![4, 5].contains(&self.bass_string_count)
        {
            return Err("楽器の設定が不正です".into());
        }
        if self.instruments.len() != INSTRUMENT_IDS.len()
            || INSTRUMENT_IDS
                .iter()
                .any(|id| !self.instruments.contains_key(*id))
        {
            return Err("楽器のチューニング設定がありません".into());
        }
        for (id, tuning) in &self.instruments {
            tuning.validate(id)?;
        }
        self.play_options.validate()?;
        for (id, play) in &self.play {
            if !INSTRUMENT_IDS.contains(&id.as_str()) {
                return Err("未対応の楽器です".into());
            }
            play.validate(id)?;
        }
        for (id, profile) in &self.profiles {
            let count = match id.as_str() {
                "guitar" => 6,
                "bass4" => 4,
                "bass5" => 5,
                _ => return Err("未対応の楽器です".into()),
            };
            let p = profile.as_object().ok_or("練習設定が不正です")?;
            if p.len() > 16 {
                return Err("練習設定の項目が多すぎます".into());
            }
            for (name, maximum) in [("strings", count), ("frets", 12)] {
                let values = p
                    .get(name)
                    .and_then(Value::as_array)
                    .ok_or("練習範囲が不正です")?;
                let minimum = if name == "strings" { 1 } else { 0 };
                if values.len() > maximum as usize + 1
                    || values
                        .iter()
                        .any(|v| v.as_u64().is_none_or(|n| n < minimum || n > maximum))
                {
                    return Err("練習範囲が不正です".into());
                }
            }
            for (field, allowed) in [
                ("mode", &["forward", "reverse", "find-all", "study"][..]),
                ("notation", &["both", "sharp", "flat"][..]),
                ("studyView", &["all", "chord", "scale"][..]),
                ("toneLabels", &["both", "name", "degree"][..]),
            ] {
                if !p
                    .get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|v| allowed.contains(&v))
                {
                    return Err(format!("{field}の設定が不正です"));
                }
            }
            for field in ["highlightRange", "showTuning", "naturalOnly"] {
                if !p.get(field).is_some_and(Value::is_boolean) {
                    return Err(format!("{field}の設定が不正です"));
                }
            }
            for field in ["studyRoot", "studyChord", "studyScale"] {
                if !p
                    .get(field)
                    .and_then(Value::as_str)
                    .is_some_and(|v| !v.is_empty() && v.len() <= 64)
                {
                    return Err(format!("{field}の設定が不正です"));
                }
            }
            let layers = p
                .get("studyLayers")
                .and_then(Value::as_array)
                .ok_or("比較設定が不正です")?;
            if layers.len() > 3
                || layers.iter().any(|layer| {
                    !layer
                        .get("kind")
                        .and_then(Value::as_str)
                        .is_some_and(|s| ["chord", "scale"].contains(&s))
                        || ["root", "pattern"].iter().any(|field| {
                            !layer
                                .get(field)
                                .and_then(Value::as_str)
                                .is_some_and(|v| !v.is_empty() && v.len() <= 64)
                        })
                })
            {
                return Err("比較設定が不正です".into());
            }
        }
        if serde_json::to_vec(self).map_err(|e| e.to_string())?.len() > 65536 {
            return Err("設定ファイルが大きすぎます".into());
        }
        Ok(())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedSettings {
    pub settings: Settings,
    pub recovered: bool,
}

pub struct SettingsStore {
    directory: PathBuf,
    lock: Mutex<()>,
}

impl SettingsStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            lock: Mutex::new(()),
        }
    }

    fn read(&self, name: &str) -> Result<Settings, String> {
        let filename = self.directory.join(name);
        if fs::metadata(&filename).map_err(|e| e.to_string())?.len() > 65536 {
            return Err("設定ファイルが大きすぎます".into());
        }
        let settings: Settings =
            serde_json::from_slice(&fs::read(filename).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        settings.migrate()
    }

    pub fn load(&self) -> Result<LoadedSettings, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        if !self.directory.join("settings.json").exists()
            && !self.directory.join("settings.backup.json").exists()
        {
            return Ok(LoadedSettings {
                settings: Settings::default(),
                recovered: false,
            });
        }
        match self.read("settings.json") {
            Ok(settings) => Ok(LoadedSettings {
                settings,
                recovered: false,
            }),
            Err(error) => {
                // A newer schema must not be silently replaced by this version.
                if self.newer_schema() {
                    return Err(
                        "新しいバージョンで保存された設定です。対応するアプリで開いてください"
                            .into(),
                    );
                }
                self.read("settings.backup.json")
                    .map(|settings| LoadedSettings {
                        settings,
                        recovered: true,
                    })
                    .map_err(|_| {
                        format!("設定を読み込めません。元のファイルは保持しています: {error}")
                    })
            }
        }
    }

    fn newer_schema(&self) -> bool {
        fs::read(self.directory.join("settings.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|v| v.get("schemaVersion").and_then(Value::as_u64))
            .is_some_and(|v| v > SCHEMA_VERSION as u64)
    }

    pub fn save(&self, settings: &Settings) -> Result<(), String> {
        settings.validate()?;
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        if self.newer_schema() {
            return Err("新しいバージョンの設定を上書きできません".into());
        }
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let temporary = self.directory.join("settings.pending.json");
        let target = self.directory.join("settings.json");
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        use std::io::Write;
        file.write_all(&serde_json::to_vec_pretty(settings).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if target.exists() {
            let valid = self.read("settings.json").is_ok();
            // Keep old schemas even after routine backups rotate.
            if valid {
                let old_version = fs::read(&target)
                    .ok()
                    .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                    .and_then(|v| v.get("schemaVersion").and_then(Value::as_u64));
                if let Some(version @ (1 | 2)) = old_version {
                    let old_backup = self
                        .directory
                        .join(format!("settings.v{version}.backup.json"));
                    if !old_backup.exists() {
                        fs::copy(&target, old_backup).map_err(|e| e.to_string())?;
                    }
                }
            }
            let backup = if valid {
                "settings.backup.json"
            } else {
                "settings.corrupt.json"
            };
            fs::copy(&target, self.directory.join(backup)).map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, target).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const V1: &str = include_str!("../../tests/fixtures/settings-v1.json");
    const V2: &str = include_str!("../../tests/fixtures/settings-v2.json");
    const V3: &str = include_str!("../../tests/fixtures/settings-v3.json");
    #[test]
    fn audio_settings_migrate_and_validate_without_losing_tunings() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("settings.json"), V2).unwrap();
        let store = SettingsStore::new(directory.path().into());
        let loaded = store.load().unwrap();
        assert_eq!(loaded.settings.schema_version, 3);
        assert_eq!(loaded.settings.audio, Some(AudioSettings::default()));
        assert_eq!(
            loaded.settings.instruments["guitar"].selected_tuning_id,
            "user:test-guitar"
        );
        store.save(&loaded.settings).unwrap();
        store.save(&loaded.settings).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("settings.v2.backup.json")).unwrap(),
            V2
        );
        let fixture: Settings = serde_json::from_str(V3).unwrap();
        fixture.validate().unwrap();
        store.save(&fixture).unwrap();
        assert_eq!(store.load().unwrap().settings, fixture);
        let mut bad = fixture.clone();
        bad.audio.as_mut().unwrap().channel = 64;
        assert!(store.save(&bad).is_err());
        bad.audio.as_mut().unwrap().channel = 1;
        bad.audio.as_mut().unwrap().reference_hz = 999.0;
        assert!(store.save(&bad).is_err());
        bad.audio.as_mut().unwrap().reference_hz = 440.0;
        bad.audio.as_mut().unwrap().gate_db = f64::NAN;
        assert!(store.save(&bad).is_err());
        assert_eq!(store.load().unwrap().settings, fixture);
    }

    #[test]
    fn migrate_old_settings_preserve_practice_and_backup() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("settings.json"), V1).unwrap();
        let store = SettingsStore::new(directory.path().into());
        let loaded = store.load().unwrap();
        assert!(!loaded.recovered);
        assert_eq!(loaded.settings.schema_version, SCHEMA_VERSION);
        assert_eq!(loaded.settings.profiles["guitar"]["mode"], "reverse");
        assert_eq!(
            loaded.settings.profiles["guitar"]["strings"],
            serde_json::json!([5, 6])
        );
        assert_eq!(loaded.settings.instruments, default_instruments());
        store.save(&loaded.settings).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("settings.backup.json")).unwrap(),
            V1
        );
        assert_eq!(
            fs::read_to_string(directory.path().join("settings.v1.backup.json")).unwrap(),
            V1
        );
        assert_eq!(store.load().unwrap().settings, loaded.settings);
        store.save(&loaded.settings).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("settings.v1.backup.json")).unwrap(),
            V1
        );
        fs::write(directory.path().join("settings.json"), b"broken").unwrap();
        let recovered = store.load().unwrap();
        assert!(recovered.recovered);
        assert_eq!(recovered.settings, loaded.settings);
    }

    #[test]
    fn custom_tunings_round_trip_and_invalid_save_cannot_replace_settings() {
        let settings: Settings = serde_json::from_str::<Settings>(V2)
            .unwrap()
            .migrate()
            .unwrap();
        settings.validate().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().into());
        store.save(&settings).unwrap();
        assert_eq!(store.load().unwrap().settings, settings);
        let mut bad = settings.clone();
        bad.instruments.get_mut("guitar").unwrap().custom_tunings[0].open_midi[5] = 116;
        assert!(store.save(&bad).is_err());
        assert_eq!(store.load().unwrap().settings, settings);
    }

    #[test]
    fn play_settings_are_optional_and_validated() {
        let mut settings = Settings::default();
        assert!(settings.validate().is_ok());
        let play = serde_json::json!({"strings": [1, 6], "frets": [0, 12], "naturalOnly": true, "tuning": {"selectedTuningId": "drop-d", "customTunings": []}});
        settings.play.insert(
            "guitar".into(),
            serde_json::from_value(play.clone()).unwrap(),
        );
        assert!(settings.validate().is_ok());
        for (field, value) in [
            ("strings", serde_json::json!([7])),
            ("frets", serde_json::json!([13])),
            (
                "tuning",
                serde_json::json!({"selectedTuningId": "drop-a", "customTunings": []}),
            ),
        ] {
            let mut bad = play.clone();
            bad[field] = value;
            let mut invalid = Settings::default();
            invalid
                .play
                .insert("guitar".into(), serde_json::from_value(bad).unwrap());
            assert!(invalid.validate().is_err(), "{field}");
        }
        let mut extra = play.clone();
        extra["count"] = serde_json::json!(10);
        assert!(serde_json::from_value::<PlaySettings>(extra).is_err());
        let mut options = Settings::default();
        options.play_options.hold_ms = 300;
        assert!(options.validate().is_err());
        let mut unknown = Settings::default();
        unknown
            .play
            .insert("ukulele".into(), serde_json::from_value(play).unwrap());
        assert!(unknown.validate().is_err());
    }

    #[test]
    fn reject_invalid_custom_tuning_and_selection() {
        let base: Value = serde_json::from_str(V2).unwrap();
        for (field, value) in [
            ("id", serde_json::json!("standard")),
            ("name", serde_json::json!("")),
            ("name", serde_json::json!("x".repeat(41))),
            ("name", serde_json::json!("bad\nname")),
            ("instrumentId", serde_json::json!("bass4")),
            ("openMidi", serde_json::json!([64])),
            ("openMidi", serde_json::json!([64, 59, 55, 50, 45, -1])),
            ("openMidi", serde_json::json!([64, 59, 55, 50, 45, 116])),
            ("openMidi", serde_json::json!([64, 59, 55, 50, 45, 38.5])),
            ("extra", serde_json::json!(true)),
        ] {
            let mut bad = base.clone();
            bad["instruments"]["guitar"]["customTunings"][0][field] = value;
            assert!(
                serde_json::from_value::<Settings>(bad)
                    .and_then(|s| s.migrate().map_err(serde::de::Error::custom))
                    .is_err(),
                "{field}"
            );
        }
        let mut bad: Settings = serde_json::from_value::<Settings>(base)
            .unwrap()
            .migrate()
            .unwrap();
        let guitar = bad.instruments.get_mut("guitar").unwrap();
        guitar.custom_tunings.push(guitar.custom_tunings[0].clone());
        assert!(bad.validate().is_err());
        let mut bad: Settings = serde_json::from_str::<Settings>(V2)
            .unwrap()
            .migrate()
            .unwrap();
        bad.instruments.get_mut("bass4").unwrap().selected_tuning_id = "drop-a".into();
        assert!(bad.validate().is_err());
        bad.instruments.remove("guitar");
        assert!(bad.validate().is_err());
        let mut bad: Settings = serde_json::from_str::<Settings>(V2)
            .unwrap()
            .migrate()
            .unwrap();
        bad.instruments.get_mut("guitar").unwrap().custom_tunings = (0..13)
            .map(|n| TuningPreset {
                id: format!("user:{n}"),
                name: "カスタム".into(),
                instrument_id: "guitar".into(),
                open_midi: vec![64, 59, 55, 50, 45, 40],
            })
            .collect();
        assert!(bad.validate().is_err());
    }

    #[test]
    fn save_restore_and_recover_from_corruption() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().into());
        assert_eq!(store.load().unwrap().settings, Settings::default());
        let first = Settings::default();
        store.save(&first).unwrap();
        let second = Settings {
            last_instrument: "bass5".into(),
            bass_string_count: 5,
            ..first.clone()
        };
        store.save(&second).unwrap();
        assert_eq!(store.load().unwrap().settings, second);
        fs::write(directory.path().join("settings.json"), b"broken").unwrap();
        let loaded = store.load().unwrap();
        assert!(loaded.recovered);
        assert_eq!(loaded.settings, first);
        store.save(&loaded.settings).unwrap();
        assert_eq!(
            fs::read(directory.path().join("settings.corrupt.json")).unwrap(),
            b"broken"
        );
    }
    #[test]
    fn reject_unknown_or_newer_schema_without_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let store = SettingsStore::new(directory.path().into());
        store.save(&Settings::default()).unwrap();
        let newer = br#"{"schemaVersion":4}"#;
        fs::write(directory.path().join("settings.json"), newer).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(&Settings::default()).is_err());
        assert_eq!(
            fs::read(directory.path().join("settings.json")).unwrap(),
            newer
        );
        let bad = Settings {
            last_instrument: "unknown".into(),
            ..Settings::default()
        };
        assert!(bad.validate().is_err());
    }

    #[test]
    fn find_all_mode_saves_and_unknown_modes_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("settings.json"), V1).unwrap();
        let store = SettingsStore::new(directory.path().into());
        let mut settings = store.load().unwrap().settings;
        settings.profiles.get_mut("guitar").unwrap()["mode"] = serde_json::json!("find-all");
        store.save(&settings).unwrap();
        assert_eq!(store.load().unwrap().settings.profiles["guitar"]["mode"], "find-all");
        settings.profiles.get_mut("guitar").unwrap()["mode"] = serde_json::json!("find-some");
        assert!(store.save(&settings).is_err());
    }
}
