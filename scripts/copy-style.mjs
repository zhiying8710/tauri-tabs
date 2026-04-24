import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve("src/tauri-tabs.css");
const target = resolve("dist/style.css");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
