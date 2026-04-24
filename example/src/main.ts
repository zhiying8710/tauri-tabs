import "./style.css";

import { createTauriTabs, type TabController, type TabState, type TauriTabsApi } from "../../src/tauri-tabs";

declare global {
  interface Window {
    tauriTabs?: TauriTabsApi;
  }
}

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
  throw new Error("Missing #app root element");
}

const appRoot = root;

type DemoEvent =
  | "ready"
  | "tab-opened"
  | "tab-added"
  | "tab-closed"
  | "tab-removed"
  | "tab-activated"
  | "tab-active"
  | "tab-deactivated"
  | "tab-visible"
  | "tab-hidden"
  | "tab-moved"
  | "tab-updated"
  | "view-created"
  | "tab-error";

appRoot.innerHTML = `
  <main class="demo-shell">
    <section class="demo-toolbar" aria-label="Tab controls">
      <div class="demo-brand">
        <strong>Tauri Tabs</strong>
        <span>Full feature example</span>
      </div>

      <label>
        Title
        <input id="titleInput" value="Example" />
      </label>
      <label>
        URL
        <input id="urlInput" value="https://example.com" />
      </label>
      <label>
        Badge
        <input id="badgeInput" value="new" />
      </label>
      <label>
        Session
        <input id="sessionInput" value="demo-session" />
      </label>
      <label>
        Icon URL
        <input id="iconInput" value="https://github.githubassets.com/favicons/favicon.svg" />
      </label>
      <label>
        Style class
        <input id="styleInput" value="demo-accent-tab" />
      </label>

      <div class="demo-actions">
        <button id="openActiveButton" type="button">Open active</button>
        <button id="openBackgroundButton" type="button">Open background</button>
        <button id="openLocalButton" type="button">Open local</button>
        <button id="openCompatButton" type="button">Compat addTab</button>
        <button id="openBlockedButton" type="button">Try blocked URL</button>
      </div>

      <div class="demo-actions">
        <button id="renameButton" type="button">Rename active</button>
        <button id="badgeButton" type="button">Set badge</button>
        <button id="styleButton" type="button">Set style</button>
        <button id="reloadButton" type="button">Change URL</button>
        <button id="toggleVisibleButton" type="button">Toggle tab header</button>
      </div>

      <div class="demo-actions">
        <button id="moveLeftButton" type="button">Move left</button>
        <button id="moveRightButton" type="button">Move right</button>
        <button id="previousButton" type="button">Previous</button>
        <button id="nextButton" type="button">Next</button>
        <button id="closeButton" type="button">Close</button>
        <button id="forceCloseButton" type="button">Force close</button>
      </div>

      <label class="demo-check">
        <input id="protectFirstTab" type="checkbox" checked />
        Protect first tab via closing event
      </label>
    </section>

    <section class="demo-workspace">
      <div id="tabsHost" class="demo-tabs-host"></div>
      <aside class="demo-panel" aria-label="State and events">
        <div class="demo-panel-section">
          <h2>Active tab</h2>
          <pre id="activeState">{}</pre>
        </div>
        <div class="demo-panel-section">
          <h2>All tabs</h2>
          <div id="tabsList" class="demo-tabs-list"></div>
        </div>
        <div class="demo-panel-section demo-log-section">
          <h2>Event log</h2>
          <div id="eventLog" class="demo-log"></div>
        </div>
      </aside>
    </section>
  </main>
`;

const tabsHost = mustQuery<HTMLElement>("#tabsHost");
const titleInput = mustQuery<HTMLInputElement>("#titleInput");
const urlInput = mustQuery<HTMLInputElement>("#urlInput");
const badgeInput = mustQuery<HTMLInputElement>("#badgeInput");
const sessionInput = mustQuery<HTMLInputElement>("#sessionInput");
const iconInput = mustQuery<HTMLInputElement>("#iconInput");
const styleInput = mustQuery<HTMLInputElement>("#styleInput");
const activeState = mustQuery<HTMLPreElement>("#activeState");
const tabsList = mustQuery<HTMLDivElement>("#tabsList");
const eventLog = mustQuery<HTMLDivElement>("#eventLog");
const protectFirstTab = mustQuery<HTMLInputElement>("#protectFirstTab");

const tabs = createTauriTabs(tabsHost, {
  newTabButton: true,
  closeButtonText: "x",
  sortable: true,
  visibilityThreshold: 1,
  className: "demo-themed-tabs",
  tabClassName: "demo-shared-tab",
  activeTabClassName: "demo-active-tab",
  defaultTab: {
    title: "Local",
    src: "/local-page.html",
    active: true,
    badge: "local"
  },
  beforeOpen: (options) => {
    if ((options.url ?? options.src ?? "").startsWith("blocked:")) {
      pushLog("beforeOpen blocked a tab");
      return false;
    }
    return true;
  }
});

window.tauriTabs = tabs;

wireEvents();
wireButtons();

void bootstrap().catch((error) => {
  pushLog(`bootstrap failed: ${error instanceof Error ? error.message : String(error)}`);
});

async function bootstrap() {
  const local = await tabs.addTab({
    title: "Local",
    src: "/local-page.html",
    active: true,
    badge: { text: "app", classname: "demo-blue-badge" },
    closable: false,
    ready: (tab) => {
      pushLog(`ready callback: ${tab.getTitle()}`);
    }
  });

  if (local) {
    local.on("closing", (_tab, abort) => {
      if (protectFirstTab.checked && typeof abort === "function") {
        abort();
        pushLog("closing event aborted the protected first tab");
      }
    });
  }

  await tabs.open({
    title: "Tauri repo",
    url: "https://github.com/tauri-apps/tauri",
    iconUrl: "https://github.githubassets.com/favicons/favicon.svg",
    badge: "web"
  });

  await tabs.addTab({
    title: "NPM API",
    src: "https://www.npmjs.com/package/@tauri-apps/api",
    badge: "npm",
    sessionKey: "npm-api-demo",
    webviewAttributes: {
      userAgent: "TauriTabsExample/0.1"
    },
    partition_generator: () => "compat-partition-demo"
  });

  renderState();
}

function wireButtons() {
  onClick("#openActiveButton", () => openFromInputs(true));
  onClick("#openBackgroundButton", () => openFromInputs(false));
  onClick("#openLocalButton", () => tabs.addTab({
    title: "Local Page",
    src: "/local-page.html",
    active: true,
    badge: "file"
  }));
  onClick("#openCompatButton", () => tabs.addTab({
    title: "Compat API",
    src: urlInput.value,
    iconURL: iconInput.value,
    badge: { text: badgeInput.value || "old", classname: "demo-green-badge" },
    auth_check: () => true,
    active: true
  }));
  onClick("#openBlockedButton", async () => {
    const result = await tabs.open({
      title: "Blocked",
      url: "blocked://demo",
      active: true
    });
    pushLog(result ? "blocked tab unexpectedly opened" : "blocked tab returned null");
  });

  onClick("#renameButton", async () => {
    const tab = requireActiveTab();
    await tab?.setTitle(`${titleInput.value || "Renamed"} ${new Date().toLocaleTimeString()}`);
  });
  onClick("#badgeButton", async () => {
    const tab = requireActiveTab();
    await tab?.setBadge({ text: badgeInput.value || "ok", classname: "demo-green-badge" });
  });
  onClick("#styleButton", async () => {
    const active = tabs.getActive();
    if (active) {
      await tabs.update(active.id, { className: styleInput.value || undefined });
    }
  });
  onClick("#reloadButton", async () => {
    const active = tabs.getActive();
    if (active) {
      await tabs.update(active.id, {
        src: urlInput.value,
        title: titleInput.value || active.title,
        className: styleInput.value || active.className,
        active: true
      });
    }
  });
  onClick("#toggleVisibleButton", async () => {
    const active = tabs.getActive();
    if (active) {
      await tabs.show(active.id, !active.visible);
    }
  });
  onClick("#moveLeftButton", () => {
    const active = tabs.getActive();
    if (active) {
      tabs.move(active.id, active.index - 1);
    }
  });
  onClick("#moveRightButton", () => {
    const active = tabs.getActive();
    if (active) {
      tabs.move(active.id, active.index + 1);
    }
  });
  onClick("#previousButton", () => tabs.getPreviousTab()?.activate());
  onClick("#nextButton", () => tabs.getNextTab()?.activate());
  onClick("#closeButton", () => requireActiveTab()?.close());
  onClick("#forceCloseButton", () => requireActiveTab()?.close(true));
}

function wireEvents() {
  const events: DemoEvent[] = [
    "ready",
    "tab-opened",
    "tab-added",
    "tab-closed",
    "tab-removed",
    "tab-activated",
    "tab-active",
    "tab-deactivated",
    "tab-visible",
    "tab-hidden",
    "tab-moved",
    "tab-updated",
    "view-created",
    "tab-error"
  ];

  for (const event of events) {
    tabs.on(event, (payload) => {
      pushLog(`${event}: ${describePayload(payload)}`);
      renderState();
    });
  }
}

async function openFromInputs(active: boolean) {
  await tabs.open({
    title: titleInput.value || undefined,
    url: urlInput.value,
    active,
    badge: badgeInput.value || undefined,
    iconUrl: iconInput.value || undefined,
    className: styleInput.value || undefined,
    sessionKey: sessionInput.value || undefined,
    viewOptions: {
      userAgent: "TauriTabsExample/0.1"
    }
  });
}

function renderState() {
  const active = tabs.getActive();
  activeState.textContent = JSON.stringify(active ?? {}, null, 2);
  const all = tabs.getAll();
  tabsList.replaceChildren(...all.map((tab) => renderTabRow(tab)));
}

function renderTabRow(tab: TabState) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "demo-tab-row";
  row.classList.toggle("is-active", tab.active);
  row.innerHTML = `
    <span>${tab.index + 1}. ${escapeHtml(tab.title)}</span>
    <small>${escapeHtml(tab.status)} / ${tab.visible ? "visible" : "hidden"}</small>
  `;
  row.addEventListener("click", () => {
    void tabs.activate(tab.id);
  });
  return row;
}

function requireActiveTab(): TabController | null {
  const tab = tabs.getActiveTab();
  if (!tab) {
    pushLog("no active tab");
  }
  return tab;
}

function onClick(selector: string, handler: () => unknown | Promise<unknown>) {
  mustQuery<HTMLButtonElement>(selector).addEventListener("click", () => {
    void Promise.resolve(handler()).catch((error) => {
      pushLog(error instanceof Error ? error.message : String(error));
    });
  });
}

function mustQuery<T extends Element>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
}

function pushLog(message: string) {
  const entry = document.createElement("div");
  entry.className = "demo-log-entry";
  entry.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  eventLog.prepend(entry);
  while (eventLog.childElementCount > 80) {
    eventLog.lastElementChild?.remove();
  }
}

function describePayload(payload: unknown) {
  if (payload && typeof payload === "object") {
    if ("getTitle" in payload && typeof payload.getTitle === "function") {
      return (payload as TabController).getTitle() ?? "tab";
    }
    if ("title" in payload) {
      return (payload as TabState).title;
    }
    if ("error" in payload) {
      return String((payload as { error: unknown }).error);
    }
  }
  return "ok";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
