import type { Webview } from "@tauri-apps/api/webview";

import type { TabBadge, TabController, TabEventName, TabId, TabState } from "./types";
import type { TabManager } from "./tab-manager";

export class TabHandle implements TabController {
  constructor(
    private readonly manager: TabManager,
    readonly id: TabId
  ) {}

  get label() {
    return this.state?.label ?? "";
  }

  get webview(): Webview | null {
    return this.manager.getWebview(this.id);
  }

  get element() {
    return Array.from(document.querySelectorAll<HTMLElement>("[data-tab-id]"))
      .find((element) => element.dataset.tabId === this.id) ?? null;
  }

  get state() {
    return this.manager.getState(this.id);
  }

  async setTitle(title: string) {
    await this.manager.update(this.id, { title });
    return this;
  }

  getTitle() {
    return this.state?.title;
  }

  async setBadge(badge?: TabBadge | string | false | null) {
    await this.manager.update(this.id, { badge });
    return this;
  }

  getBadge() {
    return this.state?.badge;
  }

  async setIcon(iconURL?: string, icon?: string) {
    await this.manager.update(this.id, { iconURL, icon });
    return this;
  }

  getIcon() {
    return this.state?.iconUrl ?? this.state?.icon;
  }

  setPosition(newPosition: number) {
    this.manager.move(this.id, newPosition);
    return this;
  }

  getPosition(fromRight = false) {
    return this.manager.getPosition(this.id, fromRight);
  }

  async activate() {
    await this.manager.activate(this.id);
    return this;
  }

  async show(flag = true) {
    await this.manager.show(this.id, flag);
    return this;
  }

  async hide() {
    await this.manager.hide(this.id);
    return this;
  }

  hasClass(className: string) {
    return Boolean(this.element?.classList.contains(className));
  }

  async close(force = false) {
    await this.manager.close(this.id, force);
  }

  on(eventName: TabEventName, handler: (...args: unknown[]) => void) {
    return this.manager.onTabEvent(this.id, eventName, handler);
  }

  once(eventName: TabEventName, handler: (...args: unknown[]) => void) {
    const unlisten = this.on(eventName, (...args) => {
      unlisten();
      handler(...args);
    });
    return unlisten;
  }
}

export function snapshotHandleState(handle: TabHandle): TabState | null {
  return handle.state;
}
