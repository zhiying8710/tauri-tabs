//! tauri-plugin-tabs —— tauri-tabs 的 Rust 端 host-guest 通信桥。
//!
//! tauri-tabs 前端库把每个 tab 渲染成同一 window 内的原生 Tauri `Webview`，
//! 并在 webview 句柄上猴补丁了一组 Electron `<webview>` 风格的方法
//! (`loadURL` / `send` / `executeJavaScript` / `openDevTools` /
//!  `addEventListener('ipc-message')`)。这些方法通过 `invoke("plugin:tabs|...")`
//! 调用本 plugin 暴露的 command，本文件就是它们的 Rust 实现。
//!
//! 通信方向：
//! - host → guest：host(主 UI)调 `emit_to_webview`，Rust 用 `webview.eval`
//!   把消息注入目标 tab webview 的 `window.__TAURI_TABS_GUEST__.__receive(event, payload)`，
//!   guest 无需任何 Tauri event 权限即可收到。
//! - guest → host：guest(tab 页)调 `emit_to_host`，Rust 广播全局事件
//!   `tauri-tabs:ipc-message`，host 侧 `listen` 后按 webview label 过滤分发。
//!
//! 权限：host 类命令(navigate/emit_to_webview/eval/open_devtools)只应授予主 UI
//! webview；`emit_to_host` 授予 `tauri-tab-*` 子 webview。详见 permissions/。

use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Emitter, Manager, Runtime, Webview,
};

/// host → guest 消息事件名（host 侧 `listen` 这个事件接收 guest 上报）。
const IPC_MESSAGE_EVENT: &str = "tauri-tabs:ipc-message";

/// 按 label 取出目标 tab webview。
fn require_webview<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<Webview<R>, String> {
    app.get_webview(label)
        .ok_or_else(|| format!("tab webview '{label}' not found"))
}

/// host 让指定 tab webview 导航到新的 URL（对应 electron `webview.loadURL`）。
#[tauri::command]
async fn navigate_webview<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    url: String,
) -> Result<(), String> {
    let webview = require_webview(&app, &label)?;
    // 优先按绝对 URL 解析；相对 URL（如 "/wxbot?tab=index"）则以 webview 当前地址为基准，
    // 与 electron webview.loadURL 接受相对路径的语义保持一致。
    let parsed = match url.parse::<tauri::Url>() {
        Ok(absolute) => absolute,
        Err(_) => webview
            .url()
            .map_err(|e| e.to_string())?
            .join(&url)
            .map_err(|e| format!("invalid url '{url}': {e}"))?,
    };
    webview.navigate(parsed).map_err(|e| e.to_string())
}

/// host → guest 推送消息（对应 electron `webview.send(event, payload)`）。
/// 通过 eval 注入 guest 的 `__TAURI_TABS_GUEST__.__receive`，guest 端无需 event 权限。
#[tauri::command]
async fn emit_to_webview<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    event: String,
    payload: Value,
) -> Result<(), String> {
    let webview = require_webview(&app, &label)?;
    // serde_json 序列化保证注入的是合法 JS 字面量，不会被 payload 内容破坏语法。
    let event_literal = serde_json::to_string(&event).map_err(|e| e.to_string())?;
    let payload_literal = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let script = format!(
        "(function(){{var g=window.__TAURI_TABS_GUEST__;\
         if(g&&typeof g.__receive==='function'){{try{{g.__receive({event_literal},{payload_literal});}}catch(e){{console.error(e);}}}}}})()"
    );
    webview.eval(&script).map_err(|e| e.to_string())
}

/// host 在指定 tab webview 执行脚本（对应 electron `webview.executeJavaScript`）。
#[tauri::command]
async fn eval_webview<R: Runtime>(
    app: AppHandle<R>,
    label: String,
    script: String,
) -> Result<(), String> {
    let webview = require_webview(&app, &label)?;
    webview.eval(&script).map_err(|e| e.to_string())
}

/// host 打开指定 tab webview 的 devtools（对应 electron `webview.openDevTools`）。
/// 仅在 debug 构建或显式开启 devtools feature 时生效，release 下安全地变为 no-op。
#[tauri::command]
async fn open_devtools<R: Runtime>(app: AppHandle<R>, label: String) -> Result<(), String> {
    let webview = require_webview(&app, &label)?;
    #[cfg(any(debug_assertions, feature = "devtools"))]
    webview.open_devtools();
    let _ = webview;
    Ok(())
}

/// guest → host 上报消息（对应 electron `ipcRenderer.sendToHost(channel, ...args)`）。
/// 调用方 webview 的 label 由框架注入，无法伪造；host 据此识别消息来自哪个 tab。
#[tauri::command]
async fn emit_to_host<R: Runtime>(
    webview: Webview<R>,
    channel: String,
    args: Value,
) -> Result<(), String> {
    let payload = json!({
        "label": webview.label(),
        "channel": channel,
        "args": args,
    });
    webview
        .emit(IPC_MESSAGE_EVENT, payload)
        .map_err(|e| e.to_string())
}

/// 初始化 plugin。在壳的 `tauri::Builder` 上 `.plugin(tauri_plugin_tabs::init())` 注册。
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("tabs")
        .invoke_handler(tauri::generate_handler![
            navigate_webview,
            emit_to_webview,
            eval_webview,
            open_devtools,
            emit_to_host,
        ])
        .build()
}
