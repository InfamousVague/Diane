#[tauri::command]
pub async fn type_text(text: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        use enigo::{Enigo, Keyboard, Settings};
        let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
        for ch in text.chars() {
            enigo.text(&ch.to_string()).map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        Ok::<(), String>(())
    }).await.map_err(|e| e.to_string())?
}
