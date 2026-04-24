import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview, type WebviewOptions } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import type { TabId, TabState } from "./types";
import { hashTo16Bytes, isProbablyMac, sanitizeSessionKey, toErrorMessage } from "./utils";

interface HostedView {
  tabId: TabId;
  label: string;
  webview: Webview;
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
    const webview = new Webview(this.appWindow, tab.label, options);
    const hosted: HostedView = {
      tabId: tab.id,
      label: tab.label,
      webview,
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
      if (hosted.desiredVisible) {
        await hosted.webview.show();
        await hosted.webview.setFocus();
      } else {
        await hosted.webview.hide();
      }
      this.delegate?.viewCreated(tabId);
    } catch (error) {
      this.handleError(tabId, hosted, error);
    }
  }

  private handleError(tabId: TabId, hosted: HostedView, error: unknown) {
    if (this.views.get(tabId) !== hosted || hosted.closed || this.destroyed) {
      return;
    }
    this.delegate?.viewError(tabId, toErrorMessage(error), error);
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
    try {
      const [innerPosition, outerPosition, scaleFactor] = await Promise.all([
        this.appWindow.innerPosition(),
        this.appWindow.outerPosition(),
        this.appWindow.scaleFactor()
      ]);
      const macTitlebarFallback = isProbablyMac() ? 28 : 0;
      return {
        x: Math.max(0, Math.round((innerPosition.x - outerPosition.x) / scaleFactor)),
        y: Math.max(macTitlebarFallback, Math.round((innerPosition.y - outerPosition.y) / scaleFactor))
      };
    } catch {
      const macTitlebarFallback = isProbablyMac() ? 28 : 0;
      return {
        x: 0,
        y: Math.max(macTitlebarFallback, Math.round(window.outerHeight - window.innerHeight))
      };
    }
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
