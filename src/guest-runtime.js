/**
 * tauri-tabs guest 运行时（在 tab 内的 guest 页里运行）。
 *
 * 这是一个零依赖、可直接 <script src> 引入的 IIFE，专为「由后端 serve 的远程
 * guest 页」准备（无 bundler、无 @tauri-apps/api）。它在 guest 侧重建了 Electron
 * `<webview>` 的 host 通信语义：
 *
 *   - guest → host：`window.__TAURI_TABS_GUEST__.sendToHost(channel, ...args)`
 *     对应 electron `ipcRenderer.sendToHost`，底层调 `plugin:tabs|emit_to_host`，
 *     由 tauri-plugin-tabs 广播 `tauri-tabs:ipc-message`，host 侧
 *     `tab.webview.addEventListener('ipc-message')` 收到。
 *   - host → guest：host 调 `tab.webview.send(event, payload)`，plugin 用 eval
 *     注入并调用本对象的 `__receive`，再分发给 `on(event, handler)` 注册的监听器，
 *     对应 electron `ipcRenderer.on`。
 *
 * guest 页只需 <script src=".../tauri-tabs-guest.js">，随后用
 * `window.__TAURI_TABS_GUEST__.on(...)` / `.sendToHost(...)`。
 */
(function () {
  if (window.__TAURI_TABS_GUEST__ && window.__TAURI_TABS_GUEST__.__installed) {
    return;
  }

  var listeners = Object.create(null);

  function invoke(cmd, args) {
    var internals = window.__TAURI_INTERNALS__;
    if (!internals || typeof internals.invoke !== "function") {
      return Promise.reject(new Error("tauri-tabs guest: tauri ipc bridge unavailable"));
    }
    return internals.invoke(cmd, args);
  }

  var guest = {
    __installed: true,

    /** host → guest：由 plugin 的 emit_to_webview 经 eval 调用，分发给 on() 监听器。 */
    __receive: function (event, payload) {
      var set = listeners[event];
      if (!set) {
        return;
      }
      // 仿 electron ipcRenderer.on 回调签名：(event, ...args)，args 取自 host 的 send 第二参。
      var ipcEvent = { channel: event, args: [payload], payload: payload };
      set.slice().forEach(function (handler) {
        try {
          handler(ipcEvent, payload);
        } catch (e) {
          console.error("tauri-tabs guest: listener error", e);
        }
      });
    },

    /** guest → host 上报一条消息（对应 electron ipcRenderer.sendToHost）。 */
    sendToHost: function (channel) {
      var args = Array.prototype.slice.call(arguments, 1);
      return invoke("plugin:tabs|emit_to_host", { channel: channel, args: args });
    },

    /** 注册 host → guest 消息监听（对应 electron ipcRenderer.on）。返回取消函数。 */
    on: function (event, handler) {
      (listeners[event] || (listeners[event] = [])).push(handler);
      var off = guest.off;
      return function () {
        off(event, handler);
      };
    },

    /** 注销监听。 */
    off: function (event, handler) {
      var set = listeners[event];
      if (!set) {
        return;
      }
      var i = set.indexOf(handler);
      if (i >= 0) {
        set.splice(i, 1);
      }
    }
  };

  window.__TAURI_TABS_GUEST__ = guest;
})();
