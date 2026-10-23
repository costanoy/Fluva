use std::sync::Mutex;

use tauri::{ipc::Response, State};

/// The same limit the app applies to any file it is given.
const MAX_FILE_BYTES: u64 = 50 * 1024 * 1024;

/// Files the app was asked to open: "Abrir com o Fluva", or a PDF
/// double-clicked once Fluva is its default app, arrive as command-line
/// arguments. They are read once at startup and handed to the page on
/// request — nothing else on disk is reachable through these commands.
struct OpenedFiles(Mutex<Vec<(String, Vec<u8>)>>);

fn files_from_args() -> Vec<(String, Vec<u8>)> {
  std::env::args_os()
    .skip(1)
    .map(std::path::PathBuf::from)
    .filter(|path| {
      let accepted = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "pdf" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "bmp" | "avif"))
        .unwrap_or(false);
      accepted && std::fs::metadata(path).map(|m| m.is_file() && m.len() <= MAX_FILE_BYTES).unwrap_or(false)
    })
    .filter_map(|path| {
      let name = path.file_name()?.to_string_lossy().into_owned();
      let bytes = std::fs::read(&path).ok()?;
      Some((name, bytes))
    })
    .collect()
}

#[tauri::command]
fn opened_file_names(files: State<OpenedFiles>) -> Vec<String> {
  files.0.lock().unwrap().iter().map(|(name, _)| name.clone()).collect()
}

/// Hands over one opened file's bytes, once — they're not kept around after.
#[tauri::command]
fn take_opened_file(index: usize, files: State<OpenedFiles>) -> Response {
  let mut list = files.0.lock().unwrap();
  let bytes = list.get_mut(index).map(|(_, bytes)| std::mem::take(bytes)).unwrap_or_default();
  Response::new(bytes)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_opener::init())
    .manage(OpenedFiles(Mutex::new(files_from_args())))
    .invoke_handler(tauri::generate_handler![opened_file_names, take_opened_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
