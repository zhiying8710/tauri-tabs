# Tauri Tabs

Native Tauri v2 tabbed webviews. The main UI renders the tab strip and state, while each tab's content is hosted by a Tauri `Webview`.

## Development

```bash
npm install
npm run tauri dev
```

For frontend-only checks:

```bash
npm run build
```

For Rust/Tauri checks:

```bash
cd src-tauri
cargo check
```

## Full Feature Example App

The default app in `src/main.ts` is a full feature example, not a minimal landing page. It demonstrates:

- New API: `open`, `update`, `move`, `getActiveTab`, `getPreviousTab`, `getNextTab`, `show`, `close`.
- Compatibility API: `addTab`, `src`, `iconURL`, `badge.classname`, `auth_check`, `partition_generator`, `ready`.
- Events: global tab events, tab-level `ready`, `closing`, `close`, and `webview-ready`.
- Session isolation: `sessionKey`, `webviewAttributes.partition`, and explicit `viewOptions`.
- Custom styling: tab shell classes, per-tab `className`, badge classes, and CSS variables.
- Migration behavior: protected close via `abort()`, force close, title/badge/icon updates, hidden tab headers, and native webview recreation on URL change.

## New API

```ts
import { createTauriTabs } from "./src/tauri-tabs";

const tabs = createTauriTabs(document.querySelector("#app")!, {
  className: "my-tab-shell",
  tabClassName: "my-tab",
  activeTabClassName: "my-active-tab",
  defaultTab: {
    title: "Local",
    url: "/local-page.html",
    active: true
  },
  beforeOpen: async (options) => options.url.length > 0
});

await tabs.open({
  title: "Example",
  url: "https://example.com",
  active: true,
  closable: true,
  iconUrl: "https://example.com/favicon.ico",
  className: "my-special-tab",
  badge: "web",
  sessionKey: "example",
  viewOptions: {
    userAgent: "TauriTabs/0.1"
  }
});

tabs.on("tab-activated", (tab) => {
  console.info("active tab", tab.title);
});
```

New API methods:

- `open(options)`
- `activate(tabId)`
- `close(tabId)`
- `move(tabId, index)`
- `update(tabId, patch)`
- `getActive()`
- `getAll()`
- `on(eventName, handler)`
- `syncLayout()`
- `destroy()`

New API events:

- `tab-opened`
- `tab-closed`
- `tab-activated`
- `tab-moved`
- `tab-updated`
- `view-created`
- `tab-error`

## Custom Styling

Tauri Tabs exposes stable DOM classes and CSS variables so apps can restyle the tab shell without replacing the native Webview behavior.

```ts
const tabs = createTauriTabs(host, {
  className: "product-tabs",
  tabClassName: "product-tab",
  activeTabClassName: "product-tab-active"
});

await tabs.open({
  title: "Builds",
  url: "/builds.html",
  className: "builds-tab",
  badge: { text: "ci", classname: "builds-badge" }
});
```

```css
.product-tabs {
  --tt-tabbar-background: #f4f7f8;
  --tt-tab-active-accent: #b85535;
  --tt-tab-badge-background: #315f82;
}

.builds-tab {
  --tt-tab-active-accent: #7f5aa2;
}

.builds-badge {
  background: #7f5aa2;
}
```

Supported style hooks:

- `className` in `TauriTabsOptions`: added to the rendered `.tt-shell`.
- `tabClassName`: added to every rendered `.tt-tab`.
- `activeTabClassName`: added to the active `.tt-tab`.
- `className` in tab options or `tabs.update(id, { className })`: added to that tab only.
- `badge.className` / `badge.classname`: added to the badge element.

Common CSS variables:

- `--tt-tabbar-height`
- `--tt-shell-background`
- `--tt-tabbar-background`
- `--tt-tabbar-border`
- `--tt-tab-border`
- `--tt-tab-background`
- `--tt-tab-hover-background`
- `--tt-tab-active-background`
- `--tt-tab-active-accent`
- `--tt-tab-error-accent`
- `--tt-tab-title-color`
- `--tt-tab-title-hover-color`
- `--tt-tab-active-title-color`
- `--tt-tab-badge-color`
- `--tt-tab-badge-background`
- `--tt-tab-close-color`
- `--tt-tab-close-hover-color`
- `--tt-tab-close-hover-background`
- `--tt-view-background`

## electron-tabs-style Compatibility API

This project does not reuse Electron's `<webview>` tag, but it exposes the common `electron-tabs` surface to reduce migration work.

```html
<tab-group new-tab-button="true" sortable="true"></tab-group>
<script type="module" src="/src/tauri-tabs.ts"></script>
<script type="module">
  const tabGroup = document.querySelector("tab-group");

  tabGroup.setDefaultTab({
    title: "Local",
    src: "/local-page.html",
    active: true
  });

  const tab = await tabGroup.addTab({
    title: "Tauri",
    src: "https://github.com/tauri-apps/tauri",
    className: "repo-tab",
    badge: { text: "web", classname: "my-badge" },
    iconURL: "https://github.githubassets.com/favicons/favicon.svg"
  });

  tab?.setTitle("Tauri repo");
  tab?.activate();
  tab?.on("webview-ready", () => console.info("ready"));
</script>
```

Compatibility methods on `<tab-group>` / returned API:

- `addTab(options?)`
- `setDefaultTab(optionsOrFactory)`
- `getTab(id)`
- `getTabByPosition(position)`
- `getTabByRelPosition(position)`
- `getNextTab()`
- `getPreviousTab()`
- `getActiveTab()`
- `getTabs()`
- `eachTab(fn, thisArg?)`
- `on(eventName, handler)`
- `once(eventName, handler)`

Compatibility methods on a tab handle:

- `setTitle(title)` / `getTitle()`
- `setBadge(badge)` / `getBadge()`
- `setIcon(iconURL, icon)` / `getIcon()`
- `setPosition(index)` / `getPosition(fromRight?)`
- `activate()`
- `show(flag?)` / `hide()`
- `hasClass(className)`
- `close(force?)`
- `on(eventName, handler)`
- `once(eventName, handler)`

Compatibility event notes:

- `tabGroup.on("tab-added", (tab, tabGroup) => {})` receives a tab handle and the `<tab-group>` element.
- `tab.on("ready", handler)` runs once the tab handle is created, matching the old component-level readiness behavior.
- `tab.on("webview-ready", handler)` runs when Tauri reports `tauri://created` for the native webview.
- `tab.on("close", (tab, meta) => {})` receives close metadata; `tab.on("closing", (tab, abort, meta) => {})` can cancel closing via `abort()`.

## Migration Map

| electron-tabs | Tauri Tabs |
| --- | --- |
| `<tab-group>` | Supported as a custom element after importing `tauri-tabs.ts` |
| `src` | Supported; normalized to `url` |
| `iconURL` | Supported; normalized to `iconUrl` |
| `className` | Supported on tab options; added to the rendered tab button |
| `badge.classname` | Supported; normalized to `badge.className` |
| `webviewAttributes.partition` | Supported; normalized to `sessionKey` |
| `partition_generator` | Supported; return a string to set `sessionKey`, return `false` to cancel |
| `auth_check` | Supported; return `false` to cancel |
| `ready(tab)` | Supported after the tab handle is created |
| `tab.webview` | Returns the Tauri `Webview` handle when available, not an Electron DOM node |
| `tab.webview.loadURL(...)` | Use `tabGroup.update(tab.id, { src: "..." })`; the native webview is recreated |
| `webview-ready` | Mapped to Tauri `tauri://created` |
| `webview-dom-ready` | Mapped to `webview-ready`; Tauri JS does not expose Electron's exact DOM-ready event |
| `did-fail-load` / renderer crash events | Reported through `tab-error` where Tauri exposes an error |
| `auto-recover-detached-tabs` | Accepted as a no-op; native Tauri webviews are not DOM children |
| `<tab-group><style>...</style></tab-group>` | Supported; direct child style tags are preserved inside the rendered tab shell |

Attributes accepted on `<tab-group>`:

- `new-tab-button`
- `new-tab-button-text`
- `close-button-text`
- `sortable`
- `visibility-threshold`
- `auto-recover-detached-tabs` (compat no-op)
- `class-name`
- `tab-class-name`
- `active-tab-class-name`

## Session Isolation

`sessionKey` is the Tauri-native replacement for Electron partitions:

- Windows and Linux map it to `dataDirectory`.
- macOS maps it to a deterministic `dataStoreIdentifier`.
- Explicit `viewOptions.dataDirectory` or `viewOptions.dataStoreIdentifier` wins over `sessionKey`.

## Security

The app grants Tauri permissions only to the main UI webview by using `webviews: ["main"]` in `src-tauri/capabilities/default.json`. Dynamic tab webviews use labels such as `tauri-tab-tab-1`, so remote pages do not receive Tauri IPC permissions.

Required permissions for the main UI are:

- `core:webview:allow-create-webview`
- `core:webview:allow-webview-show`
- `core:webview:allow-webview-hide`
- `core:webview:allow-webview-close`
- `core:webview:allow-set-webview-position`
- `core:webview:allow-set-webview-size`
- `core:webview:allow-set-webview-focus`

## Current Limits

- This implementation targets one primary tab group filling the app window.
- It uses Tauri native `Webview`; there is no iframe fallback.
- Web engine behavior differs by platform: Windows uses WebView2, macOS and Linux use WebKit.
