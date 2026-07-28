import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env"), quiet: true });

const runtimeBaseUrl = requiredUrl("GOOGLE_CALENDAR_RUNTIME_BASE_URL");
const webBaseUrl = requiredUrl("VEKIL_WEB_BASE_URL");
const healthUrl = new URL("/healthz", runtimeBaseUrl).toString();

const child = spawn("pnpm", ["--filter", "@vekil/google-calendar-runtime", "dev"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});
let stopping = false;

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    child.kill(signal);
  });
}

const exitPromise = new Promise<never>((_resolve, reject) => {
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (stopping) {
      process.exitCode = code ?? (signal ? 1 : 0);
      return;
    }
    reject(new Error(`Google Calendar Runtime exited before readiness (${code ?? signal}).`));
  });
});

try {
  await Promise.race([waitForRuntime(healthUrl, 30_000), exitPromise]);
  const builderUrl = new URL("/apps/build", webBaseUrl).toString();
  process.stdout.write(
    ["Google Calendar Runtime is ready.", `Return to ${builderUrl} and run the Runtime test.`].join(
      "\n"
    ) + "\n"
  );
  await exitPromise;
} catch (error) {
  stopping = true;
  child.kill("SIGTERM");
  throw error;
}

async function waitForRuntime(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The Runtime is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }

  throw new Error(`Google Calendar Runtime did not become ready within ${timeoutMs}ms.`);
}

function requiredUrl(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required. Run pnpm local:env first.`);
  return new URL(value).toString();
}
