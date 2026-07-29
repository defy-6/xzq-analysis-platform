import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "public", "data");
const jsonPath = path.join(dataDir, "dev-log.json");
const markdownPath = path.join(root, "开发日志.md");

async function appendLog(title, detail, type = "server") {
  const now = new Date().toISOString();
  await mkdir(dataDir, { recursive: true });
  let payload = { updatedAt: now, entries: [] };
  try { payload = JSON.parse(await readFile(jsonPath, "utf8")); } catch {}
  payload.entries = [...(payload.entries || []), { time: now, type, title, detail }].slice(-100);
  payload.updatedAt = now;
  await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await appendFile(markdownPath, `\n- ${now}｜${title}：${detail}\n`, "utf8");
}

await appendLog("开发服务器启动", "通过 pnpm web 启动本地可视化网站；网页开发日志开始实时更新。");

const executable = path.join(root, "node_modules", ".bin", "vinext");
const child = spawn(executable, ["dev"], {
  cwd: root,
  env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, ".wrangler", "wrangler.log") },
  stdio: "inherit",
});

let closing = false;
async function closeLog(code, signal) {
  if (closing) return;
  closing = true;
  const reason = signal ? `收到 ${signal} 信号` : `退出代码 ${code ?? 0}`;
  try { await appendLog("开发服务器停止", `本地可视化网站已停止（${reason}）。`); } catch {}
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", async error => {
  await closeLog(1);
  console.error(`无法启动网站：${error.message}`);
  process.exit(1);
});

child.on("exit", async (code, signal) => {
  await closeLog(code, signal);
  process.exit(code ?? 0);
});
