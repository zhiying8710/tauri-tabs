import { TabManager } from "./tab-manager";
import { TabsUI } from "./tabs-ui";
import type { OpenTabOptions, TabDefinition, TauriTabsApi, TauriTabsEventName, TauriTabsHandler, TauriTabsOptions } from "./types";
import { WebviewHost } from "./webview-host";

const BaseHTMLElement: typeof HTMLElement = typeof HTMLElement === "undefined" ? (class {} as unknown as typeof HTMLElement) : HTMLElement;

export function createTauriTabs(rootElement: HTMLElement, options: TauriTabsOptions = {}): TauriTabsApi {
  const ui = new TabsUI(rootElement, options);
  const host = new WebviewHost(ui.viewContainer);
  const manager = new TabManager(host, options);
  const onEvent = <K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>) => {
    if (eventName === "ready") {
      queueMicrotask(() => {
        (handler as TauriTabsHandler<"ready">)(api);
      });
      return () => undefined;
    }

    if (eventName === "tab-added" || eventName === "tab-removed" || eventName === "tab-active") {
      return manager.on(eventName, ((tab: unknown) => {
        (handler as (...args: unknown[]) => void)(tab, api);
      }) as TauriTabsHandler<K>);
    }

    return manager.on(eventName, handler);
  };
  const api: TauriTabsApi = {
    open: (openOptions: OpenTabOptions) => manager.open(openOptions),
    addTab: (openOptions?: TabDefinition) => manager.addTab(openOptions),
    setDefaultTab: (openOptions: TabDefinition) => manager.setDefaultTab(openOptions),
    activate: (id) => manager.activate(id),
    close: (id, force = false) => manager.close(id, force),
    move: (id, index) => manager.move(id, index),
    update: (id, patch) => manager.update(id, patch),
    show: (id, flag = true) => manager.show(id, flag),
    hide: (id) => manager.hide(id),
    getActive: () => manager.getActive(),
    getActiveTab: () => {
      const active = manager.getActive();
      return active ? manager.getTab(active.id) : null;
    },
    getAll: () => manager.getAll(),
    getTab: (id) => manager.getTab(id),
    getTabByPosition: (position) => manager.getTabByPosition(position),
    getTabByRelPosition: (position) => manager.getTabByRelPosition(position),
    getNextTab: () => manager.getNextTab(),
    getPreviousTab: () => manager.getPreviousTab(),
    getTabs: () => manager.getTabs(),
    eachTab: (fn, thisArg) => manager.eachTab(fn, thisArg),
    on: onEvent,
    once: <K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>) => {
      const unlisten = onEvent(eventName, ((...args: unknown[]) => {
        unlisten();
        (handler as (...args: unknown[]) => void)(...args);
      }) as TauriTabsHandler<K>);
      return unlisten;
    },
    syncLayout: () => manager.syncLayout(),
    setHostOverlayActive: (active) => manager.setHostOverlayActive(active),
    destroy: async () => {
      ui.destroy();
      await manager.destroy();
    }
  };
  manager.setApi(api);
  ui.bind(manager);
  return api;
}

export class TauriTabGroupElement extends BaseHTMLElement {
  private api: TauriTabsApi | null = null;

  connectedCallback() {
    if (this.api) {
      return;
    }
    this.api = createTauriTabs(this, this.readOptions());
  }

  disconnectedCallback() {
    void this.api?.destroy();
    this.api = null;
  }

  addTab(options?: TabDefinition) {
    return this.requireApi().addTab(options);
  }

  setDefaultTab(options: TabDefinition) {
    this.requireApi().setDefaultTab(options);
  }

  getTab(id: string) {
    return this.requireApi().getTab(id);
  }

  getTabByPosition(position: number) {
    return this.requireApi().getTabByPosition(position);
  }

  getTabByRelPosition(position: number) {
    return this.requireApi().getTabByRelPosition(position);
  }

  getNextTab() {
    return this.requireApi().getNextTab();
  }

  getPreviousTab() {
    return this.requireApi().getPreviousTab();
  }

  getActiveTab() {
    return this.requireApi().getActiveTab();
  }

  getTabs() {
    return this.requireApi().getTabs();
  }

  syncLayout() {
    return this.requireApi().syncLayout();
  }

  setHostOverlayActive(active: boolean) {
    return this.requireApi().setHostOverlayActive(active);
  }

  eachTab(fn: Parameters<TauriTabsApi["eachTab"]>[0], thisArg?: unknown) {
    this.requireApi().eachTab(fn, thisArg);
  }

  on(eventName: TauriTabsEventName | "ready", handler: (...args: unknown[]) => void) {
    if (eventName === "ready") {
      queueMicrotask(() => handler(this));
      return () => undefined;
    }
    if (eventName === "tab-added" || eventName === "tab-removed" || eventName === "tab-active") {
      return this.requireApi().on(eventName, ((tab: unknown) => {
        handler(tab, this);
      }) as TauriTabsHandler<TauriTabsEventName>);
    }
    return this.requireApi().on(eventName, ((payload: unknown) => {
      handler(payload);
    }) as TauriTabsHandler<TauriTabsEventName>);
  }

  once(eventName: TauriTabsEventName | "ready", handler: (...args: unknown[]) => void) {
    const unlisten = this.on(eventName, (...args) => {
      unlisten();
      handler(...args);
    });
    return unlisten;
  }

  private readOptions(): TauriTabsOptions {
    return {
      newTabButton: this.readBooleanAttribute("new-tab-button"),
      newTabButtonText: this.getAttribute("new-tab-button-text") ?? undefined,
      closeButtonText: this.getAttribute("close-button-text") || undefined,
      sortable: this.hasAttribute("sortable") ? this.readBooleanAttribute("sortable") : undefined,
      visibilityThreshold: Number(this.getAttribute("visibility-threshold")) || undefined,
      autoRecoverDetachedTabs: this.readBooleanAttribute("auto-recover-detached-tabs"),
      className: this.getAttribute("class-name") ?? undefined,
      tabClassName: this.getAttribute("tab-class-name") ?? undefined,
      activeTabClassName: this.getAttribute("active-tab-class-name") ?? undefined
    };
  }

  private readBooleanAttribute(name: string) {
    const value = this.getAttribute(name);
    return value !== null && value !== "false";
  }

  private requireApi() {
    if (!this.api) {
      throw new Error("<tab-group> is not connected yet.");
    }
    return this.api;
  }
}

export function defineTauriTabGroupElement(tagName = "tab-group") {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, TauriTabGroupElement);
  }
}

if (typeof customElements !== "undefined") {
  defineTauriTabGroupElement();
}

export type {
  OpenTabOptions,
  TabController,
  TabDefinition,
  TabBadge,
  TabErrorPayload,
  TabId,
  TabPatch,
  TabState,
  TauriTabsApi,
  TauriTabsEventName,
  TauriTabsEvents,
  TauriTabsHandler,
  TauriTabsOptions
} from "./types";
