//! Practice records, kept apart from settings.json so its strict schema and
//! 64 KB limit stay untouched. Rust checks the version, size and top-level
//! shape; the TypeScript decoder validates the contents.
use serde::Serialize;
use serde_json::Value;
use std::{fs, io::Write, path::PathBuf, sync::Mutex};

const SCHEMA_VERSION: u64 = 1;
const MAXIMUM_BYTES: u64 = 8 * 1024 * 1024;
const FILE: &str = "training-data.json";
const BACKUP: &str = "training-data.backup.json";
/// Top-level fields and, for lists, their maximum length.
const FIELDS: [(&str, Option<usize>); 7] = [
    ("preferences", None),
    ("progressions", Some(100)),
    ("stats", None),
    ("daily", Some(400)),
    ("attempts", Some(2000)),
    ("takes", Some(20)),
    ("calibration", None),
];
/// Added later, so files saved before it existed still load; same shape check when present.
const OPTIONAL_FIELDS: [(&str, Option<usize>); 1] = [("playPositions", Some(20000))];

pub fn validate(data: &Value) -> Result<(), String> {
    let object = data.as_object().ok_or("学習記録の形式が不正です")?;
    if object.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        return Err("未対応の学習記録のバージョンです".into());
    }
    let optional = OPTIONAL_FIELDS
        .iter()
        .filter(|(name, _)| object.contains_key(*name))
        .count();
    if object.len() != FIELDS.len() + optional + 1 {
        return Err("学習記録の項目が不正です".into());
    }
    let present = OPTIONAL_FIELDS
        .into_iter()
        .filter(|(name, _)| object.contains_key(*name));
    for (name, limit) in FIELDS.into_iter().chain(present) {
        let value = object.get(name).ok_or("学習記録の項目が足りません")?;
        let valid = match limit {
            Some(maximum) => value.as_array().is_some_and(|list| list.len() <= maximum),
            None => value.is_object(),
        };
        if !valid {
            return Err(format!("学習記録の{name}が不正です"));
        }
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedTraining {
    /// None when no record has been saved yet.
    pub data: Option<Value>,
    pub recovered: bool,
}

pub struct TrainingStore {
    directory: PathBuf,
    lock: Mutex<()>,
}

impl TrainingStore {
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            lock: Mutex::new(()),
        }
    }

    fn read(&self, name: &str) -> Result<Value, String> {
        let filename = self.directory.join(name);
        if fs::metadata(&filename).map_err(|e| e.to_string())?.len() > MAXIMUM_BYTES {
            return Err("学習記録が大きすぎます".into());
        }
        let data: Value = serde_json::from_slice(&fs::read(filename).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        validate(&data)?;
        Ok(data)
    }

    fn newer_schema(&self) -> bool {
        fs::read(self.directory.join(FILE))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|v| v.get("schemaVersion").and_then(Value::as_u64))
            .is_some_and(|v| v > SCHEMA_VERSION)
    }

    pub fn load(&self) -> Result<LoadedTraining, String> {
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        if !self.directory.join(FILE).exists() && !self.directory.join(BACKUP).exists() {
            return Ok(LoadedTraining {
                data: None,
                recovered: false,
            });
        }
        match self.read(FILE) {
            Ok(data) => Ok(LoadedTraining {
                data: Some(data),
                recovered: false,
            }),
            Err(error) => {
                if self.newer_schema() {
                    return Err(
                        "新しいバージョンで保存された学習記録です。対応するアプリで開いてください"
                            .into(),
                    );
                }
                self.read(BACKUP)
                    .map(|data| LoadedTraining {
                        data: Some(data),
                        recovered: true,
                    })
                    .map_err(|_| {
                        format!("学習記録を読み込めません。元のファイルは保持しています: {error}")
                    })
            }
        }
    }

    pub fn save(&self, data: &Value) -> Result<(), String> {
        validate(data)?;
        let bytes = serde_json::to_vec(data).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAXIMUM_BYTES {
            return Err("学習記録が大きすぎます".into());
        }
        let _lock = self.lock.lock().map_err(|e| e.to_string())?;
        if self.newer_schema() {
            return Err("新しいバージョンの学習記録を上書きできません".into());
        }
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let temporary = self.directory.join("training-data.pending.json");
        let target = self.directory.join(FILE);
        let mut file = fs::File::create(&temporary).map_err(|e| e.to_string())?;
        file.write_all(&bytes).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        if target.exists() {
            let backup = if self.read(FILE).is_ok() {
                BACKUP
            } else {
                "training-data.corrupt.json"
            };
            fs::copy(&target, self.directory.join(backup)).map_err(|e| e.to_string())?;
        }
        fs::rename(temporary, target).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn sample(attempts: usize) -> Value {
        json!({"schemaVersion":1,"preferences":{"play":{"octave":"exact"}},"progressions":[],"stats":{},
            "daily":[{"date":"2026-10-26","seconds":60,"attempts":1,"correct":1}],
            "attempts":vec![json!({"itemId":"play:guitar:40"}); attempts],"takes":[],"calibration":{"tapOffsetMs":null,"inputOffsetMs":null}})
    }
    #[test]
    fn saves_restores_and_recovers_from_a_corrupt_file() {
        let directory = tempfile::tempdir().unwrap();
        let store = TrainingStore::new(directory.path().into());
        let empty = store.load().unwrap();
        assert!(empty.data.is_none() && !empty.recovered);
        store.save(&sample(1)).unwrap();
        store.save(&sample(2)).unwrap();
        assert_eq!(store.load().unwrap().data, Some(sample(2)));
        fs::write(directory.path().join(FILE), "{broken").unwrap();
        let recovered = store.load().unwrap();
        assert!(recovered.recovered);
        assert_eq!(recovered.data, Some(sample(1)));
        store.save(&sample(3)).unwrap();
        assert_eq!(
            fs::read_to_string(directory.path().join("training-data.corrupt.json")).unwrap(),
            "{broken"
        );
        assert_eq!(store.load().unwrap().data, Some(sample(3)));
    }
    #[test]
    fn rejects_invalid_shapes_limits_and_newer_versions() {
        let directory = tempfile::tempdir().unwrap();
        let store = TrainingStore::new(directory.path().into());
        assert!(store.save(&sample(2001)).is_err());
        let mut extra = sample(1);
        extra["unknown"] = json!(1);
        assert!(store.save(&extra).is_err());
        let mut missing = sample(1);
        missing.as_object_mut().unwrap().remove("stats");
        assert!(store.save(&missing).is_err());
        let mut wrong = sample(1);
        wrong["daily"] = json!({});
        assert!(store.save(&wrong).is_err());
        assert!(store.load().unwrap().data.is_none());
        let mut newer = sample(1);
        newer["schemaVersion"] = json!(2);
        fs::write(directory.path().join(FILE), newer.to_string()).unwrap();
        assert!(store.load().is_err());
        assert!(store.save(&sample(1)).is_err());
        assert_eq!(
            fs::read_to_string(directory.path().join(FILE)).unwrap(),
            newer.to_string()
        );
    }
    #[test]
    fn accepts_files_with_or_without_play_positions() {
        let directory = tempfile::tempdir().unwrap();
        let store = TrainingStore::new(directory.path().into());
        let mut with = sample(1);
        with["playPositions"] = json!([{"date":"2026-10-29","instrument":"guitar","string":5,"fret":3,"midi":48,"asked":1,"answered":1,"wrong":0,"totalMs":2000}]);
        store.save(&with).unwrap();
        assert_eq!(store.load().unwrap().data, Some(with.clone()));
        store.save(&sample(1)).unwrap();
        let mut long = sample(1);
        long["playPositions"] = json!(vec![json!({}); 20001]);
        assert!(store.save(&long).is_err());
        let mut wrong = sample(1);
        wrong["playPositions"] = json!({});
        assert!(store.save(&wrong).is_err());
        let mut both = with.clone();
        both["unknown"] = json!(1);
        assert!(store.save(&both).is_err());
    }
    #[test]
    fn rejects_files_over_the_size_limit() {
        let directory = tempfile::tempdir().unwrap();
        let store = TrainingStore::new(directory.path().into());
        let mut large = sample(1);
        large["preferences"] = json!({"padding": "x".repeat(MAXIMUM_BYTES as usize)});
        assert!(store.save(&large).is_err());
        fs::write(directory.path().join(FILE), large.to_string()).unwrap();
        assert!(store.load().is_err());
    }
}
