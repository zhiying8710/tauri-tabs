import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Webview, type WebviewOptions } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { TabId, TabState } from "./types";
import { hashTo16Bytes, isProbablyMac, sanitizeSessionKey, toErrorMessage } from "./utils";

interface HostedView {
  tabId: TabId;
  label: string;
  webview: Webview;
  dispose: Array<() => void>;
  closed: boolean;
  created: boolean;
  desiredVisible: boolean;
}

interface WebviewHostDelegate {
  viewCreated(tabId: TabId): void;
  viewError(tabId: TabId, error: string, raw?: unknown): void;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Offset {
  x: number;
  y: number;
}

export class WebviewHost {
  private readonly appWindow = getCurrentWindow();
  private readonly views = new Map<TabId, HostedView>();
  private readonly resizeObserver: ResizeObserver;
  private delegate: WebviewHostDelegate | null = null;
  private contentOffset: Offset | null = null;
  private contentOffsetPromise: Promise<Offset> | null = null;
  private hostOverlayActive = false;
  private syncQueued = false;
  private destroyed = false;

  private readonly handleWindowResize = () => {
    this.contentOffset = null;
    this.contentOffsetPromise = null;
    this.scheduleSync();
  };

  constructor(private readonly container: HTMLElement) {
    this.resizeObserver = new ResizeObserver(() => {
      this.scheduleSync();
    });
    this.resizeObserver.observe(container);
    window.addEventListener("resize", this.handleWindowResize);
  }

  setDelegate(delegate: WebviewHostDelegate) {
    this.delegate = delegate;
  }

  getWebview(tabId: TabId) {
    return this.views.get(tabId)?.webview ?? null;
  }

  async create(tab: TabState) {
    const bounds = await this.getNativeBounds();
    const options = this.buildOptions(tab, bounds);
    const webview = this.decorateWebview(tab, new Webview(this.appWindow, tab.label, options));
    const hosted: HostedView = {
      tabId: tab.id,
      label: tab.label,
      webview,
      dispose: [],
      closed: false,
      created: false,
      desiredVisible: tab.active
    };
    this.views.set(tab.id, hosted);

    void webview.once("tauri://created", () => {
      void this.handleCreated(tab.id, hosted);
    });
    void webview.once<unknown>("tauri://error", (event) => {
      this.handleError(tab.id, hosted, event.payload);
    });
  }

  async show(tabId: TabId) {
    const hosted = this.views.get(tabId);
    if (!hosted || hosted.closed) {
      return;
    }

    hosted.desiredVisible = true;
    if (!hosted.created) {
      return;
    }
    if (this.hostOverlayActive) {
      await hosted.webview.hide();
      return;
    }
    await this.syncBounds(tabId);
    await hosted.webview.show();
    await hosted.webview.setFocus();
  }

  async hide(tabId: TabId) {
    const hosted = this.views.get(tabId);
    if (!hosted || hosted.closed) {
      return;
    }

    hosted.desiredVisible = false;
    if (!hosted.created) {
      return;
    }
    await hosted.webview.hide();
  }

  async close(tabId: TabId) {
    const hosted = this.views.get(tabId);
    if (!hosted || hosted.closed) {
      return;
    }

    hosted.closed = true;
    try {
      await hosted.webview.close();
    } catch (error) {
      if (hosted.created) {
        throw error;
      }
    } finally {
      if (this.views.get(tabId) === hosted) {
        hosted.dispose.forEach((dispose) => dispose());
        this.views.delete(tabId);
      }
    }
  }

  async recreate(tab: TabState) {
    await this.close(tab.id).catch(() => undefined);
    if (tab.status !== "closed") {
      await this.create(tab);
    }
  }

  async syncAll() {
    const tasks = [...this.views.keys()].map((tabId) => this.syncBounds(tabId));
    await Promise.allSettled(tasks);
  }

  async setHostOverlayActive(active: boolean) {
    this.hostOverlayActive = active;
    const tasks = [...this.views.values()].map(async (hosted) => {
      if (hosted.closed || !hosted.created) {
        return;
      }
      if (active || !hosted.desiredVisible) {
        await hosted.webview.hide();
        return;
      }
      await this.syncBounds(hosted.tabId);
      await hosted.webview.show();
      await hosted.webview.setFocus();
    });
    await Promise.allSettled(tasks);
  }

  async destroy() {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    window.removeEventListener("resize", this.handleWindowResize);
    const tasks = [...this.views.keys()].map((tabId) => this.close(tabId).catch(() => undefined));
    await Promise.all(tasks);
  }

  private async handleCreated(tabId: TabId, hosted: HostedView) {
    if (this.views.get(tabId) !== hosted || hosted.closed || this.destroyed) {
      await hosted?.webview.close().catch(() => undefined);
      if (this.views.get(tabId) === hosted) {
        this.views.delete(tabId);
      }
      return;
    }

    try {
      hosted.created = true;
      await this.syncBounds(tabId);
      if (this.hostOverlayActive) {
        await hosted.webview.hide();
      } else if (hosted.desiredVisible) {
        await hosted.webview.show();
        await hosted.webview.setFocus();
      } else {
        await hosted.webview.hide();
      }
      this.delegate?.viewCreated(tabId);
      this.dispatchCompatEvent(hosted, "dom-ready", { target: hosted.webview });
      this.dispatchCompatEvent(hosted, "did-finish-load", { target: hosted.webview });
    } catch (error) {
      this.handleError(tabId, hosted, error);
    }
  }

  private handleError(tabId: TabId, hosted: HostedView, error: unknown) {
    if (this.views.get(tabId) !== hosted || hosted.closed || this.destroyed) {
      return;
    }
    this.delegate?.viewError(tabId, toErrorMessage(error), error);
    this.dispatchCompatEvent(hosted, "did-fail-load", { target: hosted.webview, error });
  }

  private decorateWebview(tab: TabState, webview: Webview) {
    const compat = webview as Webview & Record<string, any>;
    const listeners = new Map<string, Set<(event: any) => void>>();
    const partition = typeof tab.webviewAttributes?.partition === "string" ? tab.webviewAttributes.partition : tab.sessionKey;

    compat.partition = partition;
    compat.src = tab.url;
    compat.webviewAttributes = tab.webviewAttributes ?? {};
    compat.__tauriTabsListeners = listeners;

    compat.addEventListener = (eventName: string, handler: (event: any) => void, options?: { once?: boolean } | boolean) => {
      const once = typeof options === "object" && options?.once === true;
      const wrapped = once
        ? (event: any) => {
            compat.removeEventListener(eventName, wrapped);
            handler(event);
          }
        : handler;
      const set = listeners.get(eventName) ?? new Set<(event: any) => void>();
      set.add(wrapped);
      listeners.set(eventName, set);

      if (eventName === "ipc-message" && !compat.__tauriTabsIpcUnlistenPromise) {
        compat.__tauriTabsIpcUnlistenPromise = listen<any>("tauri-tabs:ipc-message", (event) => {
          const payload = event.payload;
          if (!payload || payload.label !== tab.label) {
            return;
          }
          this.dispatchCompatEventByWebview(compat, "ipc-message", {
            target: compat,
            channel: payload.channel,
            args: payload.args ?? [],
            payload
          });
        }).then((unlisten) => {
          compat.__tauriTabsIpcUnlisten = unlisten;
          const hosted = this.views.get(tab.id);
          if (!hosted || hosted.closed) {
            // webview 在 listen 注册完成前已关闭：立即解绑，避免全局事件监听泄漏。
            unlisten();
          } else {
            hosted.dispose.push(unlisten);
          }
          return unlisten;
        });
      }
    };

    compat.removeEventListener = (eventName: string, handler: (event: any) => void) => {
      listeners.get(eventName)?.delete(handler);
    };

    compat.loadURL = async (url: string) => {
      compat.src = url;
      await invoke("plugin:tabs|navigate_webview", { label: tab.label, url });
    };
    compat.loadUrl = compat.loadURL;
    compat.send = async (event: string, payload: unknown) => {
      await invoke("plugin:tabs|emit_to_webview", { label: tab.label, event, payload });
    };
    compat.openDevTools = async () => {
      await invoke("plugin:tabs|open_devtools", { label: tab.label });
    };
    compat.executeJavaScript = async (script: string) => {
      await invoke("plugin:tabs|eval_webview", { label: tab.label, script });
    };

    return compat as Webview;
  }

  private dispatchCompatEvent(hosted: HostedView, eventName: string, event: any) {
    this.dispatchCompatEventByWebview(hosted.webview as Webview & Record<string, any>, eventName, event);
  }

  private dispatchCompatEventByWebview(webview: Webview & Record<string, any>, eventName: string, event: any) {
    const listeners = webview.__tauriTabsListeners as Map<string, Set<(event: any) => void>> | undefined;
    for (const handler of listeners?.get(eventName) ?? []) {
      try {
        handler(event);
      } catch (error) {
        console.error(error);
      }
    }
  }

  private scheduleSync() {
    if (this.syncQueued || this.destroyed) {
      return;
    }

    this.syncQueued = true;
    requestAnimationFrame(() => {
      this.syncQueued = false;
      void this.syncAll();
    });
  }

  private async syncBounds(tabId: TabId) {
    const hosted = this.views.get(tabId);
    if (!hosted || hosted.closed || !hosted.created) {
      return;
    }

    const bounds = await this.getNativeBounds();
    await hosted.webview.setPosition(new LogicalPosition(bounds.x, bounds.y));
    await hosted.webview.setSize(new LogicalSize(bounds.width, bounds.height));
  }

  private getDomBounds(): Bounds {
    const rect = this.container.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(rect.left)),
      y: Math.max(0, Math.round(rect.top)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height))
    };
  }

  private async getNativeBounds(): Promise<Bounds> {
    const bounds = this.getDomBounds();
    const offset = await this.getContentOffset();
    return {
      ...bounds,
      x: bounds.x + offset.x,
      y: bounds.y + offset.y
    };
  }

  private async getContentOffset(): Promise<Offset> {
    if (this.contentOffset) {
      return this.contentOffset;
    }

    this.contentOffsetPromise ??= this.readContentOffset();
    this.contentOffset = await this.contentOffsetPromise;
    return this.contentOffset;
  }

  private async readContentOffset(): Promise<Offset> {
    // Tauri Webview bounds use the content-area coordinate space already.
    return { x: 0, y: 0 };
  }

  private buildOptions(tab: TabState, bounds: Bounds): WebviewOptions {
    const sessionOptions = this.buildSessionOptions(tab);
    const attributeOptions = this.mapWebviewAttributes(tab.webviewAttributes);
    const explicitOptions = tab.viewOptions ?? {};

    return {
      ...sessionOptions,
      ...attributeOptions,
      ...explicitOptions,
      url: tab.url,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      focus: tab.active
    };
  }

  private mapWebviewAttributes(attributes?: Record<string, unknown>): Partial<WebviewOptions> {
    if (!attributes) {
      return {};
    }

    const options: Partial<WebviewOptions> = {};
    const userAgent = attributes.useragent ?? attributes.userAgent;
    if (typeof userAgent === "string") {
      options.userAgent = userAgent;
    }
    if (typeof attributes.devtools === "boolean") {
      options.devtools = attributes.devtools;
    }
    if (typeof attributes.javascriptDisabled === "boolean") {
      options.javascriptDisabled = attributes.javascriptDisabled;
    }
    if (typeof attributes.incognito === "boolean") {
      options.incognito = attributes.incognito;
    }
    if (typeof attributes.zoomHotkeysEnabled === "boolean") {
      options.zoomHotkeysEnabled = attributes.zoomHotkeysEnabled;
    }
    return options;
  }

  private buildSessionOptions(tab: TabState): Partial<WebviewOptions> {
    if (!tab.sessionKey) {
      return {};
    }

    if (tab.viewOptions?.dataDirectory || tab.viewOptions?.dataStoreIdentifier) {
      return {};
    }

    if (isProbablyMac()) {
      return {
        dataStoreIdentifier: hashTo16Bytes(tab.sessionKey)
      };
    }

    return {
      dataDirectory: `sessions/${sanitizeSessionKey(tab.sessionKey)}`
    };
  }
}
