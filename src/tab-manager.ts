import { TabHandle } from "./tab-handle";
import { TypedEventBus } from "./event-bus";
import type {
  CloseMeta,
  OpenTabOptions,
  TabController,
  TabDefinition,
  TabEventName,
  TabId,
  TabPatch,
  TabState,
  TauriTabsApi,
  TauriTabsEventName,
  TauriTabsEvents,
  TauriTabsHandler,
  TauriTabsOptions
} from "./types";
import { WebviewHost } from "./webview-host";
import { clampIndex, normalizeBadge, sanitizeLabelPart, titleFromUrl, toErrorMessage } from "./utils";

type CloseListener = (tab: TabController, abort: () => void, meta: CloseMeta) => void;

export class TabManager {
  private readonly bus = new TypedEventBus<TauriTabsEvents>();
  private readonly tabs: TabState[] = [];
  private readonly activationOrder: TabId[] = [];
  private readonly handles = new Map<TabId, TabHandle>();
  private readonly closeListeners = new Map<TabId, Set<CloseListener>>();
  private readonly syntheticTabListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private defaultTab?: TabDefinition;
  private api: TauriTabsApi | null = null;
  private nextId = 1;
  private destroyed = false;

  constructor(
    private readonly host: WebviewHost,
    readonly options: TauriTabsOptions
  ) {
    this.defaultTab = options.defaultTab;
    this.host.setDelegate({
      viewCreated: (tabId) => this.markViewCreated(tabId),
      viewError: (tabId, error, raw) => this.markViewError(tabId, error, raw)
    });
  }

  setApi(api: TauriTabsApi) {
    this.api = api;
  }

  on<K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>) {
    return this.bus.on(eventName, handler);
  }

  once<K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>) {
    const unlisten = this.on(eventName, (payload) => {
      unlisten();
      handler(payload);
    });
    return unlisten;
  }

  async open(input: OpenTabOptions): Promise<TabState | null> {
    const handle = await this.addTab(input);
    return handle ? handle.state : null;
  }

  async addTab(input?: TabDefinition): Promise<TabHandle | false> {
    if (this.destroyed) {
      return false;
    }

    const resolved = await this.resolveTabDefinition(input ?? this.defaultTab ?? this.createFallbackTab());
    const options = this.normalizeOpenOptions(resolved);
    if (!(await this.canOpen(options))) {
      return false;
    }

    const tab = this.createTabState(options);
    const handle = this.getOrCreateHandle(tab.id);
    this.tabs.push(tab);
    this.reindex();
    this.emit("tab-opened", tab);
    this.emitHandleEvent("tab-added", tab);

    try {
      await this.host.create(tab);
      if (options.active === true || !this.getActive()) {
        await this.activate(tab.id);
      } else {
        await this.host.hide(tab.id);
      }
      options.ready?.(handle);
      this.dispatchSyntheticTabEvent(tab.id, "ready", handle);
      return handle;
    } catch (error) {
      this.markViewError(tab.id, toErrorMessage(error), error);
      return handle;
    }
  }

  setDefaultTab(options: TabDefinition) {
    this.defaultTab = options;
  }

  async openDefault() {
    return this.addTab();
  }

  async activate(id: TabId): Promise<boolean> {
    const nextTab = this.find(id);
    if (!nextTab || nextTab.status === "closed") {
      return false;
    }

    const previousTab = this.getActiveInternal();
    if (previousTab?.id === id) {
      await this.host.show(id).catch((error) => this.markViewError(id, toErrorMessage(error), error));
      return true;
    }

    if (previousTab) {
      previousTab.active = false;
      previousTab.updatedAt = Date.now();
      await this.host.hide(previousTab.id).catch((error) => this.markViewError(previousTab.id, toErrorMessage(error), error));
      this.emit("tab-deactivated", previousTab);
    }

    nextTab.active = true;
    nextTab.updatedAt = Date.now();
    this.markRecentlyActive(id);
    await this.host.show(id).catch((error) => this.markViewError(id, toErrorMessage(error), error));
    this.emit("tab-activated", nextTab);
    this.emitHandleEvent("tab-active", nextTab);
    return true;
  }

  async close(id: TabId, force = false): Promise<boolean> {
    const tab = this.find(id);
    if (!tab || tab.status === "closed" || (!tab.closable && !force)) {
      return false;
    }

    const meta: CloseMeta = {
      force,
      source: "api",
      stack: new Error(`tab-close:${id}`).stack || ""
    };
    let aborted = false;
    const abort = () => {
      aborted = true;
    };
    for (const listener of this.closeListeners.get(id) ?? []) {
      listener(this.getOrCreateHandle(id), abort, meta);
    }
    if (aborted) {
      return false;
    }

    const wasActive = tab.active;
    tab.status = "closed";
    tab.active = false;
    tab.updatedAt = Date.now();
    this.removeFromActivationOrder(id);
    await this.host.close(id).catch((error) => this.markViewError(id, toErrorMessage(error), error));
    const index = this.tabs.findIndex((candidate) => candidate.id === id);
    if (index !== -1) {
      this.tabs.splice(index, 1);
    }
    this.reindex();
    this.emit("tab-closed", tab);
    this.dispatchSyntheticTabEvent(id, "close", this.getOrCreateHandle(id), meta);
    this.dispatchSyntheticTabEvent(id, "webview-destroyed", this.getOrCreateHandle(id), meta);
    this.emitHandleEvent("tab-removed", tab);
    this.handles.delete(id);
    this.closeListeners.delete(id);

    if (wasActive) {
      const recent = this.activationOrder.map((candidateId) => this.find(candidateId)).find((candidate): candidate is TabState => Boolean(candidate));
      if (recent) {
        await this.activate(recent.id);
      } else if (this.tabs[0]) {
        await this.activate(this.tabs[0].id);
      }
    }

    return true;
  }

  move(id: TabId, index: number) {
    const currentIndex = this.tabs.findIndex((tab) => tab.id === id);
    if (currentIndex === -1) {
      return false;
    }

    const [tab] = this.tabs.splice(currentIndex, 1);
    const nextIndex = clampIndex(index, this.tabs.length);
    this.tabs.splice(nextIndex, 0, tab);
    this.reindex();
    tab.updatedAt = Date.now();
    this.emit("tab-moved", tab);
    void this.host.syncAll();
    return true;
  }

  async update(id: TabId, patch: TabPatch): Promise<TabState | null> {
    const tab = this.find(id);
    if (!tab || tab.status === "closed") {
      return null;
    }

    const previous = this.snapshot(tab);
    const shouldRecreate = patch.url !== undefined || patch.src !== undefined || patch.sessionKey !== undefined || patch.viewOptions !== undefined || patch.tauriWebviewOptions !== undefined;
    if (patch.url !== undefined || patch.src !== undefined) {
      tab.url = patch.url ?? patch.src ?? tab.url;
      tab.title = patch.title ?? tab.title;
    }
    if (patch.title !== undefined) {
      tab.title = patch.title;
    }
    if (patch.closable !== undefined) {
      tab.closable = patch.closable;
    }
    if (patch.iconUrl !== undefined || patch.iconURL !== undefined) {
      tab.iconUrl = patch.iconUrl ?? patch.iconURL;
    }
    if (patch.icon !== undefined) {
      tab.icon = patch.icon;
    }
    if (patch.className !== undefined) {
      tab.className = patch.className;
    }
    if (patch.badge !== undefined) {
      tab.badge = normalizeBadge(patch.badge);
    }
    if (patch.visible !== undefined) {
      tab.visible = patch.visible;
      this.emit(patch.visible ? "tab-visible" : "tab-hidden", tab);
    }
    if (patch.sessionKey !== undefined) {
      tab.sessionKey = patch.sessionKey;
    }
    if (patch.webviewAttributes !== undefined) {
      tab.webviewAttributes = patch.webviewAttributes;
    }
    if (patch.viewOptions !== undefined || patch.tauriWebviewOptions !== undefined) {
      tab.viewOptions = patch.viewOptions ?? patch.tauriWebviewOptions;
    }
    tab.updatedAt = Date.now();

    if (shouldRecreate) {
      tab.status = "opening";
      await this.host.recreate(tab).catch((error) => this.markViewError(id, toErrorMessage(error), error));
    }
    if (patch.active === true) {
      await this.activate(id);
    }

    this.emitChangedTabEvents(tab, previous);
    this.emit("tab-updated", tab);
    return this.snapshot(tab);
  }

  async show(id: TabId, flag = true): Promise<boolean> {
    const tab = this.find(id);
    if (!tab || tab.status === "closed") {
      return false;
    }
    if (tab.visible === flag) {
      return true;
    }
    tab.visible = flag;
    tab.updatedAt = Date.now();
    this.emit(flag ? "tab-visible" : "tab-hidden", tab);
    this.emit("tab-updated", tab);
    return true;
  }

  hide(id: TabId) {
    return this.show(id, false);
  }

  getActive() {
    const active = this.getActiveInternal();
    return active ? this.snapshot(active) : null;
  }

  getAll() {
    return this.tabs.map((tab) => this.snapshot(tab));
  }

  getTabs() {
    return this.tabs.map((tab) => this.getOrCreateHandle(tab.id));
  }

  getTab(id: TabId) {
    return this.find(id) ? this.getOrCreateHandle(id) : null;
  }

  getTabByPosition(position: number) {
    const fromRight = position < 0;
    const tab = this.tabs.find((candidate) => this.getPosition(candidate.id, fromRight) === position);
    return tab ? this.getOrCreateHandle(tab.id) : null;
  }

  getTabByRelPosition(position: number) {
    const active = this.getActiveInternal();
    if (!active) {
      return null;
    }
    return this.getTabByPosition(active.index + position);
  }

  getNextTab() {
    return this.getTabByRelPosition(1);
  }

  getPreviousTab() {
    return this.getTabByRelPosition(-1);
  }

  eachTab(fn: (tab: TabController, index: number, tabs: TabController[]) => void, thisArg?: unknown) {
    const tabs = this.getTabs();
    tabs.forEach((tab, index) => fn.call(thisArg, tab, index, tabs));
  }

  getPosition(id: TabId, fromRight = false) {
    const tab = this.find(id);
    if (!tab) {
      return undefined;
    }
    return fromRight ? tab.index - this.tabs.length : tab.index;
  }

  getState(id: TabId) {
    const tab = this.find(id);
    return tab ? this.snapshot(tab) : null;
  }

  getWebview(id: TabId) {
    return this.host.getWebview(id);
  }

  onTabEvent(id: TabId, eventName: TabEventName, handler: (...args: unknown[]) => void) {
    if (eventName === "closing") {
      return this.addCloseListener(id, handler as CloseListener);
    }
    if (eventName === "ready") {
      if (this.find(id)) {
        queueMicrotask(() => handler(this.getOrCreateHandle(id)));
      }
      return this.addSyntheticTabListener(id, eventName, handler);
    }
    if (eventName === "title-changed" || eventName === "badge-changed" || eventName === "icon-changed" || eventName === "close" || eventName === "webview-destroyed") {
      return this.addSyntheticTabListener(id, eventName, handler);
    }

    const mapping = this.mapTabEvent(eventName);
    if (!mapping) {
      return () => undefined;
    }
    const unlisten = this.on(mapping.eventName, (payload) => {
      const tab = "tab" in (payload as object) ? (payload as { tab: TabState }).tab : (payload as TabState);
      if (tab.id !== id) {
        return;
      }
      mapping.invoke(handler, this.getOrCreateHandle(id), payload);
    });

    const current = this.find(id);
    if (eventName === "webview-ready" && current?.status === "ready") {
      queueMicrotask(() => handler(this.getOrCreateHandle(id)));
    }
    return unlisten;
  }

  async syncLayout() {
    await this.host.syncAll();
  }

  async setHostOverlayActive(active: boolean) {
    await this.host.setHostOverlayActive(active);
  }

  async destroy() {
    this.destroyed = true;
    await this.host.destroy();
    this.bus.clear();
    this.tabs.splice(0);
    this.activationOrder.splice(0);
    this.handles.clear();
    this.closeListeners.clear();
    this.syntheticTabListeners.clear();
  }

  private normalizeOpenOptions(input: OpenTabOptions): OpenTabOptions {
    const webviewAttributes = input.webviewAttributes ? { ...input.webviewAttributes } : undefined;
    const partition = webviewAttributes?.partition;
    const sessionKey = input.sessionKey ?? (typeof partition === "string" ? partition : undefined);
    const viewOptions = input.viewOptions ?? input.tauriWebviewOptions;
    const url = input.url ?? input.src;
    if (!url) {
      throw new Error("A tab requires `url` or `src`.");
    }

    return {
      ...input,
      url,
      src: url,
      title: input.title?.trim() || titleFromUrl(url),
      closable: input.closable !== false,
      iconUrl: input.iconUrl ?? input.iconURL,
      className: input.className,
      visible: input.visible !== false,
      badge: normalizeBadge(input.badge),
      sessionKey,
      webviewAttributes,
      viewOptions
    };
  }

  private async resolveTabDefinition(definition: TabDefinition): Promise<OpenTabOptions> {
    return typeof definition === "function" ? definition(this.requireApi()) : definition;
  }

  private createFallbackTab(): OpenTabOptions {
    return {
      title: "Local",
      url: "/local-page.html",
      active: true
    };
  }

  private async canOpen(options: OpenTabOptions) {
    const api = this.requireApi();
    const partition = await options.partition_generator?.(api, options);
    if (partition === false) {
      return false;
    }
    if (typeof partition === "string") {
      options.sessionKey = partition;
      options.webviewAttributes = {
        ...(options.webviewAttributes ?? {}),
        partition
      };
    }

    const tabAuth = await options.auth_check?.(api, options);
    if (tabAuth === false) {
      return false;
    }

    const globalAuth = await this.options.beforeOpen?.(options);
    return globalAuth !== false;
  }

  private createTabState(options: OpenTabOptions): TabState {
    const now = Date.now();
    const id = `tab-${this.nextId}`;
    this.nextId += 1;
    return {
      id,
      label: `tauri-tab-${sanitizeLabelPart(id)}`,
      index: this.tabs.length,
      url: options.url ?? options.src ?? "/local-page.html",
      title: options.title ?? titleFromUrl(options.url ?? options.src ?? ""),
      active: false,
      closable: options.closable !== false,
      iconUrl: options.iconUrl ?? options.iconURL,
      icon: options.icon,
      className: options.className,
      badge: normalizeBadge(options.badge),
      visible: options.visible !== false,
      sessionKey: options.sessionKey,
      webviewAttributes: options.webviewAttributes,
      viewOptions: options.viewOptions ?? options.tauriWebviewOptions,
      status: "opening",
      createdAt: now,
      updatedAt: now
    };
  }

  private markViewCreated(tabId: TabId) {
    const tab = this.find(tabId);
    if (!tab || tab.status === "closed") {
      return;
    }
    tab.status = "ready";
    tab.error = undefined;
    tab.updatedAt = Date.now();
    this.emit("view-created", tab);
    this.emit("tab-updated", tab);
  }

  private markViewError(tabId: TabId, error: string, raw?: unknown) {
    const tab = this.find(tabId);
    if (!tab || tab.status === "closed") {
      return;
    }
    tab.status = "error";
    tab.error = error;
    tab.updatedAt = Date.now();
    const snapshot = this.snapshot(tab);
    this.bus.emit("tab-error", { tab: snapshot, error, raw });
    this.bus.emit("tab-updated", snapshot);
  }

  private emit<K extends TauriTabsEventName>(eventName: K, tab: TabState) {
    this.bus.emit(eventName, this.snapshot(tab) as TauriTabsEvents[K]);
  }

  private emitHandleEvent(eventName: "tab-added" | "tab-removed" | "tab-active", tab: TabState) {
    this.bus.emit(eventName, this.getOrCreateHandle(tab.id) as TauriTabsEvents[typeof eventName]);
  }

  private emitChangedTabEvents(tab: TabState, previous: TabState) {
    const handle = this.getOrCreateHandle(tab.id);
    if (tab.title !== previous.title) {
      this.dispatchSyntheticTabEvent(tab.id, "title-changed", tab.title, handle);
    }
    if (tab.badge?.text !== previous.badge?.text || tab.badge?.className !== previous.badge?.className) {
      this.dispatchSyntheticTabEvent(tab.id, "badge-changed", tab.badge, handle);
    }
    if (tab.iconUrl !== previous.iconUrl || tab.icon !== previous.icon) {
      this.dispatchSyntheticTabEvent(tab.id, "icon-changed", tab.iconUrl ?? tab.icon, handle);
    }
  }

  private dispatchSyntheticTabEvent(tabId: TabId, eventName: TabEventName, ...args: unknown[]) {
    for (const listener of this.syntheticTabListeners.get(`${tabId}:${eventName}`) ?? []) {
      listener(...args);
    }
  }

  private mapTabEvent(eventName: TabEventName) {
    const invokeWithTab = (handler: (...args: unknown[]) => void, tab: TabHandle) => handler(tab);
    const eventMap: Partial<Record<TabEventName, TauriTabsEventName>> = {
      ready: "view-created",
      "webview-ready": "view-created",
      "webview-dom-ready": "view-created",
      "webview-did-fail-load": "tab-error",
      "webview-render-process-gone": "tab-error",
      "webview-unresponsive": "tab-error",
      active: "tab-activated",
      inactive: "tab-deactivated",
      visible: "tab-visible",
      hidden: "tab-hidden",
      "tab-error": "tab-error"
    };

    const mapped = eventMap[eventName];
    if (!mapped) {
      return null;
    }
    return {
      eventName: mapped,
      invoke: (handler: (...args: unknown[]) => void, tab: TabHandle, payload: unknown) => {
        if (eventName === "tab-error") {
          handler((payload as { error?: unknown }).error, payload, tab);
        } else {
          invokeWithTab(handler, tab);
        }
      }
    };
  }

  private addCloseListener(id: TabId, handler: CloseListener) {
    const listeners = this.closeListeners.get(id) ?? new Set<CloseListener>();
    listeners.add(handler);
    this.closeListeners.set(id, listeners);
    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this.closeListeners.delete(id);
      }
    };
  }

  private addSyntheticTabListener(id: TabId, eventName: TabEventName, handler: (...args: unknown[]) => void) {
    const key = `${id}:${eventName}`;
    const listeners = this.syntheticTabListeners.get(key) ?? new Set<(...args: unknown[]) => void>();
    listeners.add(handler);
    this.syntheticTabListeners.set(key, listeners);
    return () => {
      listeners.delete(handler);
      if (listeners.size === 0) {
        this.syntheticTabListeners.delete(key);
      }
    };
  }

  private find(id: TabId) {
    return this.tabs.find((tab) => tab.id === id) ?? null;
  }

  private getActiveInternal() {
    return this.tabs.find((tab) => tab.active) ?? null;
  }

  private getOrCreateHandle(id: TabId) {
    const cached = this.handles.get(id);
    if (cached) {
      return cached;
    }
    const handle = new TabHandle(this, id);
    this.handles.set(id, handle);
    return handle;
  }

  private markRecentlyActive(id: TabId) {
    this.removeFromActivationOrder(id);
    this.activationOrder.unshift(id);
  }

  private removeFromActivationOrder(id: TabId) {
    const index = this.activationOrder.indexOf(id);
    if (index !== -1) {
      this.activationOrder.splice(index, 1);
    }
  }

  private reindex() {
    this.tabs.forEach((tab, index) => {
      tab.index = index;
    });
  }

  private snapshot(tab: TabState): TabState {
    return {
      ...tab,
      badge: tab.badge ? { ...tab.badge } : undefined,
      webviewAttributes: tab.webviewAttributes ? { ...tab.webviewAttributes } : undefined,
      viewOptions: tab.viewOptions ? { ...tab.viewOptions } : undefined
    };
  }

  private requireApi() {
    if (!this.api) {
      throw new Error("TauriTabs API is not attached yet.");
    }
    return this.api;
  }
}
