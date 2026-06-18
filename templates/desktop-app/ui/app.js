/**
 * Frontend de la app de escritorio (corre en el webview de Tauri).
 *
 * Llama a los comandos Rust definidos en `src-tauri/src/lib.rs` con `invoke()`,
 * abre el diálogo nativo con el plugin de dialog, y controla la ventana con la
 * API de window. Cuando se sirve fuera de Tauri (`bun run ui` / un navegador),
 * `window.__TAURI__` no existe y caemos a stubs para que la UI siga viva.
 */

const tauri = window.__TAURI__;
const inTauri = Boolean(tauri);

const $ = (id) => document.getElementById(id);
const setStatus = (msg) => ($('status').textContent = msg);

async function invoke(cmd, args) {
  if (!inTauri) {
    setStatus(`[demo navegador] invoke("${cmd}") no disponible fuera de Tauri`);
    return null;
  }
  return tauri.core.invoke(cmd, args);
}

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
  const path = await tauri.dialog.open({ multiple: false, title: 'Elegí un archivo' });
  if (!path) {
    setStatus('Selección cancelada.');
    return;
  }
  $('file-path').textContent = path;
  setStatus('Leyendo archivo…');
  try {
    const content = await invoke('leer_archivo', { ruta: path });
    $('file-content').textContent = content ?? '';
    setStatus(`Cargado (${(content ?? '').length} caracteres).`);
  } catch (err) {
    $('file-content').textContent = '';
    setStatus(`Error: ${err}`);
  }
}

async function changeTitle() {
  const nuevo = `Iskra Desktop · ${new Date().toLocaleTimeString()}`;
  if (inTauri) {
    await tauri.window.getCurrentWindow().setTitle(nuevo);
  }
  setStatus(`Título: ${nuevo}`);
}

async function minimize() {
  if (inTauri) {
    await tauri.window.getCurrentWindow().minimize();
  } else {
    setStatus('Minimizar solo funciona dentro de Tauri.');
  }
}

$('btn-open').addEventListener('click', openFile);
$('btn-title').addEventListener('click', changeTitle);
$('btn-minimize').addEventListener('click', minimize);

loadAppInfo().catch((err) => setStatus(`Error cargando info: ${err}`));
