import type { TabState, TauriTabsOptions } from "./types";
import { TabManager } from "./tab-manager";

export class TabsUI {
  readonly viewContainer: HTMLDivElement;

  private readonly shell: HTMLDivElement;
  private readonly tabList: HTMLDivElement;
  private readonly newButton: HTMLButtonElement;
  private manager: TabManager | null = null;
  private draggingId: string | null = null;
  private readonly unlisten: Array<() => void> = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly options: TauriTabsOptions
  ) {
    const styleNodes = Array.from(root.children)
      .filter((child): child is HTMLStyleElement => child instanceof HTMLStyleElement)
      .map((style) => style.cloneNode(true));

    this.shell = document.createElement("div");
    this.shell.className = "tt-shell";
    addClassNames(this.shell, options.className);

    const nav = document.createElement("div");
    nav.className = "tt-tabbar";

    this.tabList = document.createElement("div");
    this.tabList.className = "tt-tabs";
    this.tabList.setAttribute("role", "tablist");
    this.tabList.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    this.tabList.addEventListener("drop", (event) => {
      event.preventDefault();
      const id = event.dataTransfer?.getData("text/plain") || this.draggingId;
      const manager = this.requireManager();
      if (id && manager) {
        manager.move(id, manager.getAll().length);
      }
      this.draggingId = null;
    });

    const actions = document.createElement("div");
    actions.className = "tt-actions";

    this.newButton = document.createElement("button");
    this.newButton.className = "tt-icon-button";
    this.newButton.type = "button";
    this.newButton.title = "New tab";
    this.newButton.ariaLabel = "New tab";
    this.newButton.textContent = options.newTabButtonText ?? "+";
    this.newButton.hidden = options.newTabButton === false;
    this.newButton.addEventListener("click", () => {
      const manager = this.requireManager();
      if (manager) {
        void manager.openDefault();
      }
    });

    actions.appendChild(this.newButton);
    nav.append(this.tabList, actions);

    this.viewContainer = document.createElement("div");
    this.viewContainer.className = "tt-view-frame";
    this.viewContainer.ariaHidden = "true";

    this.shell.append(...styleNodes, nav, this.viewContainer);
    this.root.replaceChildren(this.shell);
  }

  bind(manager: TabManager) {
    this.manager = manager;
    for (const eventName of ["tab-opened", "tab-closed", "tab-activated", "tab-moved", "tab-updated"] as const) {
      this.unlisten.push(manager.on(eventName, () => this.render()));
    }
    this.render();
  }

  destroy() {
    for (const unlisten of this.unlisten.splice(0)) {
      unlisten();
    }
    this.root.replaceChildren();
  }

  render() {
    const manager = this.requireManager();
    const allTabs = manager?.getAll() ?? [];
    const tabs = allTabs.filter((tab) => tab.visible);
    const fragment = document.createDocumentFragment();

    for (const tab of tabs) {
      fragment.appendChild(this.renderTab(tab));
    }

    this.tabList.replaceChildren(fragment);
    this.scrollActiveTabIntoView();
    this.shell.classList.toggle("tt-empty", allTabs.length === 0);
    this.shell.classList.toggle("tt-hide-tabbar", allTabs.length < (manager?.options.visibilityThreshold ?? 0));
    void manager?.syncLayout();
  }

  private renderTab(tab: TabState) {
    const element = document.createElement("div");
    element.className = "tt-tab";
    element.draggable = this.manager?.options.sortable !== false;
    element.dataset.tabId = tab.id;
    element.title = tab.title;
    element.ariaSelected = String(tab.active);
    element.setAttribute("role", "tab");
    element.tabIndex = tab.active ? 0 : -1;
    element.classList.toggle("is-active", tab.active);
    element.classList.toggle("is-error", tab.status === "error");
    addClassNames(element, this.options.tabClassName, tab.className);
    if (tab.active) {
      addClassNames(element, this.options.activeTabClassName);
    }
    element.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || (event.target as Element | null)?.closest("button")) {
        return;
      }
      const manager = this.requireManager();
      if (manager) {
        void manager.activate(tab.id);
      }
    });
    element.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }
      event.preventDefault();
      const manager = this.requireManager();
      if (manager) {
        void manager.activate(tab.id);
      }
    });
    element.addEventListener("auxclick", (event) => {
      if (event.button === 1) {
        event.preventDefault();
        const manager = this.requireManager();
        if (manager) {
          void manager.close(tab.id);
        }
      }
    });
    element.addEventListener("dragstart", (event) => {
      this.draggingId = tab.id;
      event.dataTransfer?.setData("text/plain", tab.id);
      event.dataTransfer?.setDragImage(element, 12, 12);
      element.classList.add("is-dragging");
    });
    element.addEventListener("dragend", () => {
      this.draggingId = null;
      element.classList.remove("is-dragging");
    });
    element.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    element.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const id = event.dataTransfer?.getData("text/plain") || this.draggingId;
      const manager = this.requireManager();
      if (manager && id && id !== tab.id) {
        manager.move(id, tab.index);
      }
      this.draggingId = null;
    });

    if (tab.iconUrl || tab.icon) {
      if (tab.iconUrl) {
        const icon = document.createElement("img");
        icon.className = "tt-tab-icon";
        icon.src = tab.iconUrl;
        icon.alt = "";
        element.appendChild(icon);
      } else if (tab.icon) {
        const icon = document.createElement("span");
        icon.className = `tt-tab-symbol ${tab.icon}`;
        icon.ariaHidden = "true";
        element.appendChild(icon);
      }
    }

    const title = document.createElement("span");
    title.className = "tt-tab-title";
    title.textContent = tab.title;
    element.appendChild(title);

    if (tab.badge) {
      const badge = document.createElement("span");
      badge.className = `tt-tab-badge${tab.badge.className ? ` ${tab.badge.className}` : ""}`;
      badge.textContent = tab.badge.text;
      element.appendChild(badge);
    }

    const status = document.createElement("span");
    status.className = "tt-tab-status";
    status.textContent = tab.status === "opening" ? "" : tab.status === "error" ? "!" : "";
    element.appendChild(status);

    if (tab.closable) {
      const close = document.createElement("span");
      close.className = "tt-tab-close";
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.title = "Close tab";
      closeButton.ariaLabel = "Close tab";
      closeButton.textContent = this.manager?.options.closeButtonText || "×";
      closeButton.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const manager = this.requireManager();
        if (manager) {
          void manager.close(tab.id);
        }
      });
      close.appendChild(closeButton);
      element.appendChild(close);
    }

    return element;
  }

  private scrollActiveTabIntoView() {
    const activeTab = this.tabList.querySelector<HTMLElement>(".tt-tab.is-active");
    activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  private requireManager() {
    return this.manager;
  }
}

function addClassNames(element: HTMLElement, ...classNames: Array<string | undefined>) {
  const tokens = classNames.flatMap((className) => className?.trim().split(/\s+/).filter(Boolean) ?? []);
  if (tokens.length > 0) {
    element.classList.add(...tokens);
  }
}
