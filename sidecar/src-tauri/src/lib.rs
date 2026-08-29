// Purchasing Intelligence sidecar — Rust core.
//
// Owns everything that must outlive the webview: SQLite persistence, the
// OS-keychain master key, AES-256-GCM field encryption, and the loopback
// bridge listener (127.0.0.1 only, pairing-token gated). Business logic runs
// in the TypeScript frontend; bridge requests round-trip through the webview
// via a Tauri event + per-request channel.

use std::collections::HashMap;
use std::io::Read;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine as _;
use rand::RngCore;
use rusqlite::Connection;
use serde_json::{json, Map, Value};
use tauri::{Emitter, Manager};

const KEYRING_SERVICE: &str = "com.purchasingintelligence.sidecar";
const BRIDGE_DEFAULT_PORT: u16 = 43180;
const BRIDGE_BODY_LIMIT: usize = 256 * 1024;
const BRIDGE_RESPONSE_TIMEOUT: Duration = Duration::from_secs(15);
const MIGRATION_1: &str = include_str!("../migrations/0001_init.sql");
const MIGRATION_2: &str = include_str!("../migrations/0002_product_intelligence.sql");
const SCHEMA_VERSION: i64 = 2;

struct DbState {
    conn: Mutex<Connection>,
    db_path: String,
}

struct CryptoState {
    master_key: Option<[u8; 32]>,
}

#[derive(Clone)]
struct BridgeState {
    pairing_token: String,
    port: u16,
    pending: Arc<Mutex<HashMap<String, SyncSender<String>>>>,
}

fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

fn now_iso() -> String {
    // RFC3339 UTC without pulling in chrono: seconds precision is enough here.
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86_400;
    let (mut y, mut remaining_days) = (1970i64, days as i64);
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let len = if leap { 366 } else { 365 };
        if remaining_days < len {
            break;
        }
        remaining_days -= len;
        y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_lengths = [
        31,
        if leap { 29 } else { 28 },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    let mut month = 1;
    for len in month_lengths {
        if remaining_days < len {
            break;
        }
        remaining_days -= len;
        month += 1;
    }
    let day = remaining_days + 1;
    let tod = secs % 86_400;
    format!(
        "{y:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        tod / 3600,
        (tod % 3600) / 60,
        tod % 60
    )
}

fn open_database(app: &tauri::AppHandle) -> Result<DbState, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create data dir: {e}"))?;
    let path = dir.join("purchasing-intelligence.sqlite3");
    let conn = Connection::open(&path).map_err(|e| format!("open sqlite: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    // Forward-only migrations, each applied once and recorded in user_version.
    if version < 1 {
        conn.execute_batch(MIGRATION_1).map_err(|e| format!("migration 1: {e}"))?;
    }
    if version < 2 {
        conn.execute_batch(MIGRATION_2).map_err(|e| format!("migration 2: {e}"))?;
    }
    if version < SCHEMA_VERSION {
        conn.pragma_update(None, "user_version", SCHEMA_VERSION)
            .map_err(|e| e.to_string())?;
    }

    // local_profile mirrors the version for the UI and bridge, which read
    // through the SQL abstraction rather than issuing PRAGMAs. Left un-synced
    // it reports a stale version forever, which would silently defeat the
    // minimum-version gating on configuration packs.
    //
    // Deliberately unconditional: databases migrated before this sync existed
    // already have the correct user_version, so gating it on `version <
    // SCHEMA_VERSION` would never repair them. The write is idempotent.
    conn.execute(
        "UPDATE local_profile SET schema_version = ?1 WHERE schema_version <> ?1",
        rusqlite::params![SCHEMA_VERSION],
    )
    .map_err(|e| format!("schema version sync: {e}"))?;

    Ok(DbState {
        conn: Mutex::new(conn),
        db_path: path.to_string_lossy().to_string(),
    })
}

fn load_master_key() -> Option<[u8; 32]> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, "master-key").ok()?;
    match entry.get_password() {
        Ok(b64) => {
            let bytes = B64.decode(b64).ok()?;
            bytes.try_into().ok()
        }
        Err(keyring::Error::NoEntry) => {
            let mut key = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut key);
            entry.set_password(&B64.encode(key)).ok()?;
            Some(key)
        }
        Err(_) => None,
    }
}

fn ensure_local_profile(db: &DbState, app_version: &str) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|_| "db lock poisoned")?;
    let existing: Option<String> = conn
        .query_row("SELECT pairing_token FROM local_profile LIMIT 1", [], |row| row.get(0))
        .map(Some)
        .or_else(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => Ok(None),
            other => Err(other.to_string()),
        })?;
    if let Some(token) = existing {
        return Ok(token);
    }
    let pairing_token = random_hex(32);
    let device_id = format!("dev-{}", random_hex(12));
    let now = now_iso();
    conn.execute(
        "INSERT INTO local_profile (id, pseudonymous_device_id, pairing_token, schema_version, app_version, preferences_json, created_at, updated_at)
         VALUES (?1, ?2, ?3, 1, ?4, '{}', ?5, ?5)",
        rusqlite::params!["profile", device_id, pairing_token, app_version, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(pairing_token)
}

// ---------- generic DB access commands (app webview only) ----------

fn bind_params(params: &[Value]) -> Vec<rusqlite::types::Value> {
    params
        .iter()
        .map(|value| match value {
            Value::Null => rusqlite::types::Value::Null,
            Value::Bool(b) => rusqlite::types::Value::Integer(if *b { 1 } else { 0 }),
            Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    rusqlite::types::Value::Integer(i)
                } else {
                    rusqlite::types::Value::Real(n.as_f64().unwrap_or(0.0))
                }
            }
            Value::String(s) => rusqlite::types::Value::Text(s.clone()),
            other => rusqlite::types::Value::Text(other.to_string()),
        })
        .collect()
}

#[tauri::command]
fn db_query(
    state: tauri::State<DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Map<String, Value>>, String> {
    let conn = state.conn.lock().map_err(|_| "db lock poisoned")?;
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let column_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let bound = bind_params(&params);
    let mut rows = stmt
        .query(rusqlite::params_from_iter(bound.iter()))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut object = Map::new();
        for (index, name) in column_names.iter().enumerate() {
            let value = match row.get_ref(index).map_err(|e| e.to_string())? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Integer(i) => json!(i),
                rusqlite::types::ValueRef::Real(f) => json!(f),
                rusqlite::types::ValueRef::Text(t) => json!(String::from_utf8_lossy(t)),
                rusqlite::types::ValueRef::Blob(b) => json!(B64.encode(b)),
            };
            object.insert(name.clone(), value);
        }
        out.push(object);
    }
    Ok(out)
}

#[tauri::command]
fn db_execute(
    state: tauri::State<DbState>,
    sql: String,
    params: Vec<Value>,
) -> Result<Value, String> {
    let conn = state.conn.lock().map_err(|_| "db lock poisoned")?;
    let bound = bind_params(&params);
    let changes = conn
        .execute(&sql, rusqlite::params_from_iter(bound.iter()))
        .map_err(|e| e.to_string())?;
    Ok(json!({ "changes": changes, "lastInsertRowid": conn.last_insert_rowid() }))
}

// ---------- field encryption ----------

#[tauri::command]
fn encrypt_text(state: tauri::State<CryptoState>, plain: String) -> Result<String, String> {
    match &state.master_key {
        Some(key_bytes) => {
            let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key_bytes));
            let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
            let ciphertext = cipher
                .encrypt(&nonce, plain.as_bytes())
                .map_err(|_| "encryption failed")?;
            let mut packed = nonce.to_vec();
            packed.extend(ciphertext);
            Ok(format!("enc1:{}", B64.encode(packed)))
        }
        // Honest degradation: without a keychain-backed key we never pretend
        // encryption happened. The UI surfaces encryptionAvailable=false.
        None => Ok(format!("plain:{plain}")),
    }
}

#[tauri::command]
fn decrypt_text(state: tauri::State<CryptoState>, value: String) -> Result<String, String> {
    if let Some(plain) = value.strip_prefix("plain:") {
        return Ok(plain.to_string());
    }
    let Some(b64_payload) = value.strip_prefix("enc1:") else {
        return Ok(value); // legacy/unencrypted value stored as-is
    };
    let key_bytes = state.master_key.ok_or("encryption key unavailable")?;
    let packed = B64.decode(b64_payload).map_err(|_| "bad ciphertext encoding")?;
    if packed.len() < 13 {
        return Err("ciphertext too short".into());
    }
    let (nonce_bytes, ciphertext) = packed.split_at(12);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(&key_bytes));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce_bytes), ciphertext)
        .map_err(|_| "decryption failed")?;
    String::from_utf8(plain).map_err(|_| "decrypted bytes not utf8".into())
}

// ---------- local export ----------

/// User-initiated local data export. Writes into the app's own data dir and
/// returns the path — nothing is uploaded anywhere.
#[tauri::command]
fn write_export(app: tauri::AppHandle, content: String) -> Result<String, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = now_iso().replace(':', "-");
    let path = dir.join(format!("purchasing-intelligence-export-{stamp}.json"));
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

// ---------- runtime info + bridge ----------

#[tauri::command]
fn get_runtime_info(
    app: tauri::AppHandle,
    db: tauri::State<DbState>,
    crypto: tauri::State<CryptoState>,
    bridge: tauri::State<BridgeState>,
) -> Result<Value, String> {
    Ok(json!({
        "version": app.package_info().version.to_string(),
        "dbPath": db.db_path,
        "bridgePort": bridge.port,
        "pairingToken": bridge.pairing_token,
        "encryptionAvailable": crypto.master_key.is_some(),
        "platform": std::env::consts::OS,
    }))
}

#[tauri::command]
fn bridge_respond(
    bridge: tauri::State<BridgeState>,
    id: String,
    response: String,
) -> Result<(), String> {
    let sender = {
        let mut pending = bridge.pending.lock().map_err(|_| "pending lock poisoned")?;
        pending.remove(&id)
    };
    match sender {
        Some(tx) => {
            let _ = tx.send(response);
            Ok(())
        }
        None => Err("unknown or timed-out bridge request id".into()),
    }
}

fn cors_headers(origin: Option<&str>) -> Vec<tiny_http::Header> {
    let mut headers = vec![
        tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Cache-Control"[..], &b"no-store"[..]).unwrap(),
        tiny_http::Header::from_bytes(&b"Vary"[..], &b"Origin"[..]).unwrap(),
    ];
    // Only extension origins get CORS read access; ordinary web pages never do.
    if let Some(origin) = origin {
        if origin.starts_with("chrome-extension://") {
            headers.push(
                tiny_http::Header::from_bytes(b"Access-Control-Allow-Origin".as_slice(), origin.as_bytes())
                    .unwrap(),
            );
            headers.push(
                tiny_http::Header::from_bytes(
                    &b"Access-Control-Allow-Headers"[..],
                    &b"content-type, x-pi-pairing-token"[..],
                )
                .unwrap(),
            );
            headers.push(
                tiny_http::Header::from_bytes(
                    &b"Access-Control-Allow-Methods"[..],
                    &b"POST, GET, OPTIONS"[..],
                )
                .unwrap(),
            );
        }
    }
    headers
}

fn respond(
    request: tiny_http::Request,
    status: u16,
    body: String,
    origin: Option<String>,
) {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    for header in cors_headers(origin.as_deref()) {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn handle_bridge_request(
    app: tauri::AppHandle,
    bridge: BridgeState,
    mut request: tiny_http::Request,
) {
    let origin = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Origin"))
        .map(|h| h.value.as_str().to_string());

    let method = request.method().clone();
    let url = request.url().to_string();

    if method == tiny_http::Method::Options {
        respond(request, 204, String::new(), origin);
        return;
    }
    if method == tiny_http::Method::Get && url == "/health" {
        respond(
            request,
            200,
            json!({ "service": "purchasing-intelligence-sidecar", "bridge": true }).to_string(),
            origin,
        );
        return;
    }
    if method != tiny_http::Method::Post || url != "/bridge" {
        respond(request, 404, json!({"ok": false, "error": {"code": "NOT_FOUND", "message": "Unknown route."}}).to_string(), origin);
        return;
    }

    let token = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("X-PI-Pairing-Token"))
        .map(|h| h.value.as_str().to_string());
    if token.as_deref() != Some(bridge.pairing_token.as_str()) {
        respond(request, 401, json!({"ok": false, "error": {"code": "UNAUTHORIZED", "message": "Missing or invalid pairing token."}}).to_string(), origin);
        return;
    }

    if request.body_length().unwrap_or(0) > BRIDGE_BODY_LIMIT {
        respond(request, 413, json!({"ok": false, "error": {"code": "PAYLOAD_TOO_LARGE", "message": "Request body too large."}}).to_string(), origin);
        return;
    }
    let mut body = String::new();
    if request
        .as_reader()
        .take(BRIDGE_BODY_LIMIT as u64 + 1)
        .read_to_string(&mut body)
        .is_err()
        || body.len() > BRIDGE_BODY_LIMIT
    {
        respond(request, 400, json!({"ok": false, "error": {"code": "BAD_REQUEST", "message": "Unreadable body."}}).to_string(), origin);
        return;
    }

    let request_id = random_hex(16);
    let (tx, rx) = sync_channel::<String>(1);
    if let Ok(mut pending) = bridge.pending.lock() {
        pending.insert(request_id.clone(), tx);
    }
    let emitted = app.emit("bridge-request", json!({ "id": request_id, "body": body }));
    if emitted.is_err() {
        if let Ok(mut pending) = bridge.pending.lock() {
            pending.remove(&request_id);
        }
        respond(request, 503, json!({"ok": false, "error": {"code": "SIDECAR_UI_UNAVAILABLE", "message": "Sidecar UI is not running."}}).to_string(), origin);
        return;
    }

    match rx.recv_timeout(BRIDGE_RESPONSE_TIMEOUT) {
        Ok(response_json) => respond(request, 200, response_json, origin),
        Err(_) => {
            if let Ok(mut pending) = bridge.pending.lock() {
                pending.remove(&request_id);
            }
            respond(request, 504, json!({"ok": false, "error": {"code": "SIDECAR_TIMEOUT", "message": "Sidecar did not answer in time (is the window open?)."}}).to_string(), origin);
        }
    }
}

fn start_bridge_server(app: tauri::AppHandle, bridge: BridgeState) {
    std::thread::spawn(move || {
        // Loopback ONLY — never bind to all interfaces.
        let server = match tiny_http::Server::http(("127.0.0.1", bridge.port)) {
            Ok(server) => server,
            Err(error) => {
                eprintln!("[bridge] failed to bind 127.0.0.1:{}: {error}", bridge.port);
                return;
            }
        };
        eprintln!("[bridge] listening on 127.0.0.1:{}", bridge.port);
        for request in server.incoming_requests() {
            let app = app.clone();
            let bridge = bridge.clone();
            std::thread::spawn(move || handle_bridge_request(app, bridge, request));
        }
    });
}

fn pick_bridge_port() -> u16 {
    std::env::var("LOCAL_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(BRIDGE_DEFAULT_PORT)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let db = open_database(&handle).map_err(std::io::Error::other)?;
            let app_version = handle.package_info().version.to_string();
            let pairing_token = ensure_local_profile(&db, &app_version).map_err(std::io::Error::other)?;
            let crypto = CryptoState { master_key: load_master_key() };
            if crypto.master_key.is_none() {
                eprintln!("[crypto] OS keychain unavailable — field encryption DISABLED (surfaced in UI)");
            }
            let bridge = BridgeState {
                pairing_token,
                port: pick_bridge_port(),
                pending: Arc::new(Mutex::new(HashMap::new())),
            };
            app.manage(db);
            app.manage(crypto);
            app.manage(bridge.clone());
            start_bridge_server(handle, bridge);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_query,
            db_execute,
            encrypt_text,
            decrypt_text,
            get_runtime_info,
            bridge_respond,
            write_export
        ])
        .run(tauri::generate_context!())
        .expect("error while running Purchasing Intelligence sidecar");
}
