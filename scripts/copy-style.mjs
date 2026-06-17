import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

await mkdir(resolve("dist"), { recursive: true });

// 样式
await copyFile(resolve("src/tauri-tabs.css"), resolve("dist/style.css"));

// guest 运行时（零依赖 IIFE，供 tab 内的远程 guest 页 <script src> 引入）
await copyFile(resolve("src/guest-runtime.js"), resolve("dist/guest.js"));
