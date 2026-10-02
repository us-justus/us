import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stagingEnvFile = path.join(root, ".env.staging.local");

try {
  process.loadEnvFile(stagingEnvFile);
} catch {
  console.error("dev:staging: missing or unreadable .env.staging.local");
  process.exit(1);
}

process.env.__NEXT_PROCESSED_ENV = "true";

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", ...process.argv.slice(2)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
