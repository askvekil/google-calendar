import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), ".env"), quiet: true });

const repositoryRoot = realpathSync(process.cwd());
const runtimePort = readRuntimePort();
const pids = readListeningPids(runtimePort);

for (const pid of pids) {
  const cwd = readProcessCwd(pid);
  if (!cwd || !isInsideRepository(cwd)) {
    throw new Error(
      `Port ${runtimePort} is used by process ${pid} outside this repository (${cwd ?? "unknown"}).`
    );
  }
  process.kill(pid, "SIGTERM");
}

if (pids.length > 0) {
  await waitForExit(pids, 5_000);
  for (const pid of pids.filter(isRunning)) {
    process.kill(pid, "SIGKILL");
  }
  process.stdout.write("Stopped the local Google Calendar Runtime.\n");
} else {
  process.stdout.write("No local Google Calendar Runtime is running.\n");
}

function readListeningPids(port: number): number[] {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8"
    })
      .trim()
      .split(/\s+/u)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}

function readProcessCwd(pid: number): string | null {
  try {
    return realpathSync(
      execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
        encoding: "utf8"
      })
        .split("\n")
        .find((line) => line.startsWith("n"))
        ?.slice(1) ?? ""
    );
  } catch {
    return null;
  }
}

function isInsideRepository(path: string): boolean {
  return path === repositoryRoot || path.startsWith(`${repositoryRoot}/`);
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pidsToWaitFor: number[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && pidsToWaitFor.some(isRunning)) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
}

function readRuntimePort(): number {
  const raw = process.env.GOOGLE_CALENDAR_RUNTIME_PORT?.trim() || "4100";
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("GOOGLE_CALENDAR_RUNTIME_PORT must be a valid TCP port.");
  }
  return port;
}
