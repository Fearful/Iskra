use std::fs;

/// Comando IPC invocable desde el frontend con `invoke('leer_archivo', { ruta })`.
/// Lee un archivo de texto y devuelve su contenido, o un error legible.
#[tauri::command]
fn leer_archivo(ruta: String) -> Result<String, String> {
    fs::read_to_string(&ruta).map_err(|e| format!("No se pudo leer {ruta}: {e}"))
}

/// Comando de ejemplo que devuelve metadatos de la app.
#[tauri::command]
fn app_info() -> serde_json::Value {
    serde_json::json!({
        "name": "Iskra Desktop App",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![leer_archivo, app_info])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación Tauri");
}
