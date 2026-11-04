fn main() {
    match fret_notes_lib::audio::input_devices() {
        Ok(devices) => println!("{}", serde_json::to_string_pretty(&devices).unwrap()),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
