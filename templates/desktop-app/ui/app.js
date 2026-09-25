/**
 * Frontend de la app de escritorio (corre en el webview de Tauri).
 *
 * Llama a los comandos Rust definidos en `src-tauri/src/lib.rs` y controla la
 * ventana. Tauri 2 inyecta siempre `window.__TAURI_INTERNALS__`, el IPC que usa
 * `@tauri-apps/api` por dentro; `window.__TAURI__` solo existe con
 * `app.withGlobalTauri`, que expone la API entera a cualquier script de la
 * pagina. Esta UI, sin bundler, usa el IPC directamente y solo para lo que
 * necesita (y la capability `default` decide que comandos acepta Rust). Fuera de
 * Tauri (un navegador comun) cae a stubs para que la UI siga viva.
 */

const ipc = window.__TAURI_INTERNALS__;
const inTauri = typeof ipc?.invoke === 'function';

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => ($('status').textContent = msg);

async function invoke(cmd, args) {
  if (!inTauri) {
    setStatus(`[demo navegador] invoke("${cmd}") no disponible fuera de Tauri`);
    return null;
  }
  return ipc.invoke(cmd, args);
}

// Lo mismo que hacen getCurrentWindow().setTitle() / .minimize() de @tauri-apps/api.
const currentWindow = () => ipc.metadata.currentWindow.label;

async function loadAppInfo() {
  const info = inTauri
    ? await invoke('app_info')
    : { name: 'Iskra Desktop App', version: 'demo' };
  $('app-info').textContent = `${info.name} v${info.version}`;
}

async function openFile() {
  if (!inTauri) {
    setStatus('El diálogo de archivos solo funciona dentro de Tauri.');
    return;
  }
  setStatus('Elegí un archivo…');
  try {
    // El diálogo y la lectura corren en Rust: la página no elige qué ruta se lee.
    const archivo = await invoke('abrir_archivo');
    if (!archivo) {
      setStatus('Selección cancelada.');
      return;
    }
    $('file-path').textContent = archivo.ruta;
    $('file-content').textContent = archivo.contenido;
    setStatus(`Cargado (${archivo.contenido.length} caracteres).`);
  } catch (err) {
    $('file-content').textContent = '';
    setStatus(`Error: ${err}`);
  }
}

async function changeTitle() {
  const nuevo = `Iskra Desktop · ${new Date().toLocaleTimeString()}`;
  if (inTauri) {
    await invoke('plugin:window|set_title', { label: currentWindow(), value: nuevo });
  }
  setStatus(`Título: ${nuevo}`);
}

async function minimize() {
  if (inTauri) {
    await invoke('plugin:window|minimize', { label: currentWindow() });
  } else {
    setStatus('Minimizar solo funciona dentro de Tauri.');
  }
}

$('btn-open').addEventListener('click', openFile);
$('btn-title').addEventListener('click', changeTitle);
$('btn-minimize').addEventListener('click', minimize);

loadAppInfo().catch((err) => setStatus(`Error cargando info: ${err}`));
