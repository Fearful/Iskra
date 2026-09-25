use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use serde::Serialize;
use tauri_plugin_dialog::DialogExt;

/// Tope de lo que se lee de un archivo: el contenido viaja entero por el IPC
/// hasta el webview.
const MAX_BYTES: u64 = 1024 * 1024;

/// Respuesta de `abrir_archivo`.
#[derive(Serialize)]
struct ArchivoLeido {
    ruta: String,
    contenido: String,
}

/// Comando IPC invocable desde el frontend con `invoke('abrir_archivo')`.
///
/// Abre el diálogo nativo y lee el archivo que elige el usuario: la ruta nunca
/// viene del webview. El comando anterior, `leer_archivo(ruta)`, leía cualquier
/// ruta que le pasara la página, así que un script inyectado podía leer, por
/// ejemplo, `~/.ssh/id_ed25519`. Devuelve `None` si el usuario cancela.
///
/// Es `async` porque el diálogo bloqueante no puede correr en el hilo
/// principal, que es donde corren los comandos sincrónicos.
#[tauri::command]
async fn abrir_archivo(app: tauri::AppHandle) -> Result<Option<ArchivoLeido>, String> {
    let Some(elegido) = app
        .dialog()
        .file()
        .set_title("Elegí un archivo")
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let ruta = elegido
        .into_path()
        .map_err(|e| format!("Ruta no soportada: {e}"))?;
    let contenido =
        leer_texto(&ruta).map_err(|e| format!("No se pudo leer {}: {e}", ruta.display()))?;
    Ok(Some(ArchivoLeido {
        ruta: ruta.display().to_string(),
        contenido,
    }))
}

/// Lee un archivo de texto UTF-8 de hasta `MAX_BYTES`.
fn leer_texto(ruta: &Path) -> io::Result<String> {
    let demasiado_grande = || io::Error::other(format!("supera {MAX_BYTES} bytes"));
    let archivo = File::open(ruta)?;
    if archivo.metadata()?.len() > MAX_BYTES {
        return Err(demasiado_grande());
    }
    let mut contenido = String::new();
    // take(): el archivo puede crecer entre metadata() y la lectura.
    archivo.take(MAX_BYTES + 1).read_to_string(&mut contenido)?;
    if contenido.len() as u64 > MAX_BYTES {
        return Err(demasiado_grande());
    }
    Ok(contenido)
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
        // Cada comando tambien esta declarado en build.rs y concedido en
        // capabilities/default.json: sin eso, cualquier webview los invoca.
        .invoke_handler(tauri::generate_handler![abrir_archivo, app_info])
        .run(tauri::generate_context!())
        .expect("error al iniciar la aplicación Tauri");
}
