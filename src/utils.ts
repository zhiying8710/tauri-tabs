import type { TabBadge } from "./types";

export function clampIndex(index: number, length: number) {
  if (!Number.isFinite(index)) {
    return length;
  }
  return Math.max(0, Math.min(Math.trunc(index), length));
}

export function normalizeBadge(input: TabBadge | string | false | null | undefined): TabBadge | undefined {
  if (!input) {
    return undefined;
  }

  if (typeof input === "string") {
    return { text: input };
  }

  const text = input.text.trim();
  if (!text) {
    return undefined;
  }
  return {
    text,
    className: input.className ?? input.classname
  };
}

export function sanitizeLabelPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-/:_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "tab";
}

export function sanitizeSessionKey(value: string) {
  return sanitizeLabelPart(value).replace(/[/:]/g, "-");
}

export function hashTo16Bytes(value: string) {
  let a = 0x811c9dc5;
  let b = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a ^= code;
    a = Math.imul(a, 0x01000193);
    b ^= code + index;
    b = Math.imul(b, 0x85ebca6b);
  }

  const bytes: number[] = [];
  for (const seed of [a, b, a ^ b, Math.imul(a + b, 0xc2b2ae35)]) {
    bytes.push(seed & 0xff, (seed >>> 8) & 0xff, (seed >>> 16) & 0xff, (seed >>> 24) & 0xff);
  }
  return bytes;
}

export function isProbablyMac() {
  return /mac/i.test(navigator.platform) || /macintosh/i.test(navigator.userAgent);
}

export function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function titleFromUrl(url: string) {
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.hostname.replace(/^www\./, "");
    }
  } catch {
    // Fall back to the raw string below.
  }
  return url.split("/").filter(Boolean).at(-1) || "New Tab";
}
