# Tauri Tabs Tasks

- [x] 1. Project scaffold
- [x] 2. Tabs UI
- [x] 3. TabManager
- [x] 4. WebviewHost
- [x] 5. Tauri permissions/security
- [x] 6. Docs and examples
- [x] 7. Verification

## Verification Checklist

- [x] `npm run build`
- [x] `cargo check`
- [x] Smoke test tab open/activate/close/sort in `npm run tauri dev`
- [x] Resize keeps active webview below the tab bar
- [x] Remote tab has no Tauri IPC access
- [x] `sessionKey` maps to a stable Tauri storage option

## Verification Notes

- Static verification completed with `npm run build` and `cargo check`.
- Static security verification completed: permissions are scoped to the `main` webview, while tab webviews use `tauri-tab-*` labels.
- Static session verification completed: `sessionKey` deterministically maps to `dataStoreIdentifier` on macOS and `sessions/<key>` data directories elsewhere.
- GUI launch verification completed with `npm run tauri dev`.
- GUI smoke checks completed in the debug `.app` bundle so desktop automation could target the macOS bundle id.
- GUI smoke checks covered opening a local tab, activating a remote tab, closing the active tab, moving tab order, and resizing the window with the active webview below the tab bar.
- Extended GUI checks covered active/background open, rename, badge update, URL recreation, hidden/visible tab headers, previous/next activation, blocked `beforeOpen`, compat `addTab`, protected close abort, force close, default new tab, tab move, and regular close.
- Tab bar visual checks covered native webview layering below the DOM tab bar and active-tab horizontal scrolling when many tabs are open.
- Custom style GUI check covered opening a tab with a per-tab `className` and updating the active tab's style class at runtime.
- Runtime IPC security check completed with `/ipc-probe.html`: child tab webviews can see Tauri internals, but `plugin:app|version` is blocked by ACL because permissions are only allowed for the `main` webview.

## Code Review Rounds

- [x] Round 1: Feature parity review against `electron-tabs`; found missing migration aliases and tab handle methods.
- [x] Round 2: Migration-cost review; added `addTab`, `setDefaultTab`, tab handles, `src`/`iconURL`/`partition` compatibility, and `<tab-group>` custom element.
- [x] Round 3: Tauri/runtime review; verified build and Rust checks, kept GUI/IPC smoke checks as manual validation.
- [x] Round 4: Event/API compatibility review; preserved direct child style tags, made `ready` component-level, and removed `CSS.escape` dependency.
- [x] Round 5: Migration ergonomics review; restored close/destroyed synthetic events with close metadata and fixed `<tab-group>` event callback arguments.
- [x] Round 6: Runtime race review; guarded stale native webview callbacks during close/recreate races.
- [x] Round 7: Migration API review; added programmatic `getActiveTab()` alias and built a full feature example app.

## Example App Coverage

- [x] New API open/update/move/show/close/navigation controls
- [x] Compatibility API addTab/src/iconURL/badge.classname/auth_check/partition_generator
- [x] Global and tab-level event logging
- [x] Protected close via `closing` + `abort()`
- [x] Session and webview option examples
- [x] Active tab inspector and tab list controls
- [x] Custom shell/tab/active-tab classes, per-tab class updates, badge classes, and CSS variable theming

## Compatibility Notes

- Electron's DOM `<webview>` is replaced by Tauri native `Webview`; `tab.webview` returns a Tauri handle when available.
- Electron-only load/crash/DOM-ready events are mapped where Tauri exposes equivalent lifecycle information, with exact limitations documented in `README.md`.

## Notes

- Project is staged in `/tmp/tauri-tabs` first, then copied to `/Users/zhiying8710/wk/tauri-tabs` after verification.
