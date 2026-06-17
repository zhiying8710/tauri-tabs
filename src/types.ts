import type { WebviewOptions } from "@tauri-apps/api/webview";

export type MaybePromise<T> = T | Promise<T>;
export type TabId = string;
export type TabStatus = "opening" | "ready" | "error" | "closed";

export interface TabBadge {
  text: string;
  className?: string;
  classname?: string;
}

export interface OpenTabOptions {
  url?: string;
  src?: string;
  title?: string;
  active?: boolean;
  closable?: boolean;
  iconUrl?: string;
  iconURL?: string;
  icon?: string;
  className?: string;
  badge?: TabBadge | string | false | null;
  visible?: boolean;
  sessionKey?: string;
  webviewAttributes?: Record<string, unknown>;
  tauriWebviewOptions?: Partial<WebviewOptions>;
  viewOptions?: Partial<WebviewOptions>;
  ready?: (tab: TabController) => void;
  auth_check?: (tabs: TauriTabsApi, options: OpenTabOptions) => MaybePromise<boolean>;
  partition_generator?: (tabs: TauriTabsApi, options: OpenTabOptions) => MaybePromise<string | void | false>;
}

export interface TabState {
  id: TabId;
  label: string;
  index: number;
  url: string;
  title: string;
  active: boolean;
  closable: boolean;
  iconUrl?: string;
  icon?: string;
  className?: string;
  badge?: TabBadge;
  visible: boolean;
  sessionKey?: string;
  webviewAttributes?: Record<string, unknown>;
  viewOptions?: Partial<WebviewOptions>;
  status: TabStatus;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type TabPatch = Partial<OpenTabOptions>;

export interface TabErrorPayload {
  tab: TabState;
  error: string;
  raw?: unknown;
}

export interface TauriTabsEvents {
  ready: TauriTabsApi;
  "tab-opened": TabState;
  "tab-added": TabController;
  "tab-closed": TabState;
  "tab-removed": TabController;
  "tab-activated": TabState;
  "tab-active": TabController;
  "tab-deactivated": TabState;
  "tab-visible": TabState;
  "tab-hidden": TabState;
  "tab-moved": TabState;
  "tab-updated": TabState;
  "view-created": TabState;
  "tab-error": TabErrorPayload;
}

export type TauriTabsEventName = keyof TauriTabsEvents;
export type TauriTabsHandler<K extends TauriTabsEventName> = (payload: TauriTabsEvents[K]) => void;

export interface TauriTabsOptions {
  defaultTab?: OpenTabOptions | (() => MaybePromise<OpenTabOptions>);
  beforeOpen?: (options: OpenTabOptions) => MaybePromise<boolean | void>;
  newTabButton?: boolean;
  newTabButtonText?: string;
  closeButtonText?: string;
  sortable?: boolean;
  visibilityThreshold?: number;
  autoRecoverDetachedTabs?: boolean;
  className?: string;
  tabClassName?: string;
  activeTabClassName?: string;
}

export interface TauriTabsApi {
  open(options: OpenTabOptions): Promise<TabState | null>;
  addTab(options?: TabDefinition): Promise<TabController | false>;
  setDefaultTab(options: TabDefinition): void;
  activate(id: TabId): Promise<boolean>;
  close(id: TabId, force?: boolean): Promise<boolean>;
  move(id: TabId, index: number): boolean;
  update(id: TabId, patch: TabPatch): Promise<TabState | null>;
  show(id: TabId, flag?: boolean): Promise<boolean>;
  hide(id: TabId): Promise<boolean>;
  getActive(): TabState | null;
  getActiveTab(): TabController | null;
  getAll(): TabState[];
  getTab(id: TabId): TabController | null;
  getTabByPosition(position: number): TabController | null;
  getTabByRelPosition(position: number): TabController | null;
  getNextTab(): TabController | null;
  getPreviousTab(): TabController | null;
  getTabs(): TabController[];
  eachTab(fn: (tab: TabController, index: number, tabs: TabController[]) => void, thisArg?: unknown): void;
  on<K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>): () => void;
  once<K extends TauriTabsEventName>(eventName: K, handler: TauriTabsHandler<K>): () => void;
  syncLayout(): Promise<void>;
  destroy(): Promise<void>;
}

export type TabDefinition = OpenTabOptions | ((tabs: TauriTabsApi) => MaybePromise<OpenTabOptions>);

export interface CloseMeta {
  force: boolean;
  source: string;
  stack: string;
}

export type TabEventName =
  | "ready"
  | "webview-ready"
  | "webview-dom-ready"
  | "webview-did-fail-load"
  | "webview-render-process-gone"
  | "webview-unresponsive"
  | "webview-destroyed"
  | "title-changed"
  | "badge-changed"
  | "icon-changed"
  | "active"
  | "inactive"
  | "visible"
  | "hidden"
  | "close"
  | "closing"
  | "tab-error";

export interface TabController {
  readonly id: TabId;
  readonly label: string;
  readonly webview: unknown | null;
  readonly webviewAttributes?: Record<string, unknown>;
  readonly element: HTMLElement | null;
  readonly state: TabState | null;
  setTitle(title: string): Promise<TabController>;
  getTitle(): string | undefined;
  setBadge(badge?: TabBadge | string | false | null): Promise<TabController>;
  getBadge(): TabBadge | undefined;
  setIcon(iconURL?: string, icon?: string): Promise<TabController>;
  getIcon(): string | undefined;
  setPosition(newPosition: number): TabController;
  getPosition(fromRight?: boolean): number | undefined;
  activate(): Promise<TabController>;
  show(flag?: boolean): Promise<TabController>;
  hide(): Promise<TabController>;
  hasClass(className: string): boolean;
  close(force?: boolean): Promise<void>;
  on(eventName: TabEventName, handler: (...args: unknown[]) => void): () => void;
  once(eventName: TabEventName, handler: (...args: unknown[]) => void): () => void;
}
