use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use serde::Serialize;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

#[derive(Clone, Serialize)]
struct EngineInfo {
    base_url: String,
    token: String,
}

#[tauri::command]
fn engine_info(state: tauri::State<EngineInfo>) -> EngineInfo {
    state.inner().clone()
}

#[tauri::command]
fn keyring_set(key: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new("SessionMail", &key).map_err(|err| err.to_string())?;
    entry.set_password(&secret).map_err(|err| err.to_string())
}

#[tauri::command]
fn keyring_get(key: String) -> Result<String, String> {
    let entry = keyring::Entry::new("SessionMail", &key).map_err(|err| err.to_string())?;
    entry.get_password().map_err(|err| err.to_string())
}

#[tauri::command]
fn keyring_delete(key: String) -> Result<(), String> {
    let entry = keyring::Entry::new("SessionMail", &key).map_err(|err| err.to_string())?;
    entry.delete_credential().map_err(|err| err.to_string())
}

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("a free local port")
        .local_addr()
        .expect("the bound address")
        .port()
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("system random");
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn data_dir() -> std::path::PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    std::path::PathBuf::from(base).join("Session")
}

fn wait_for_port(port: u16) {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    for _ in 0..60 {
        if TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok() {
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn spawn_engine(app: &tauri::AppHandle) -> Result<EngineInfo, Box<dyn std::error::Error>> {
    let port = free_port();
    let token = random_token();
    let dir = data_dir();
    std::fs::create_dir_all(&dir)?;
    let engine_dir = app.path().resource_dir()?.join("engine-dist");
    let command = app
        .shell()
        .sidecar("session-mail-engine")?
        .env("SESSION_HOST", "127.0.0.1")
        .env("SESSION_PORT", port.to_string())
        .env("SESSION_TOKEN", &token)
        .env("SESSION_DATA_DIR", &dir)
        .env("SESSION_ENGINE_DIR", &engine_dir)
        .env("SESSION_SECRET_STORE", "keyring");
    let (_rx, _child) = command.spawn()?;
    wait_for_port(port);
    Ok(EngineInfo {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
    })
}

fn dev_engine() -> EngineInfo {
    let port = std::env::var("SESSION_PORT").unwrap_or_else(|_| "8765".into());
    let token = std::env::var("SESSION_TOKEN").unwrap_or_else(|_| "dev-session-token".into());
    EngineInfo {
        base_url: format!("http://127.0.0.1:{port}"),
        token,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let info = if cfg!(debug_assertions) {
                dev_engine()
            } else {
                spawn_engine(app.handle())?
            };
            app.manage(info);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            keyring_set,
            keyring_get,
            keyring_delete
        ])
        .run(tauri::generate_context!())
        .expect("Session window failed to open");
}
