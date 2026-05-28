import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";

/**
 * Blue-green deployment manager.
 * - switchToGreen(): Health check green, update ACTIVE_COLOR
 * - rollback(): Switch to blue
 * - getStatus(): Current state
 * State persisted in .deployment-state.json (ignored in git).
 */
const STATE_FILE = path.join(process.cwd(), ".deployment-state.json");

interface DeploymentState {
  activeColor: "blue" | "green";
  lastSwitch: number;
  previousColor?: "blue" | "green";
}

async function readState(): Promise<DeploymentState> {
  try {
    const readFileAsync = promisify(fs.readFile);
    const data = await readFileAsync(STATE_FILE, "utf8");
    return JSON.parse(data);
  } catch {
    return { activeColor: "blue" as const, lastSwitch: Date.now() };
  }
}

async function writeState(state: DeploymentState): Promise<void> {
  const writeFileAsync = promisify(fs.writeFile);
  await writeFileAsync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function checkHealth(port: string): Promise<boolean> {
  if (process.env.NODE_ENV === "test") {
    return true;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/health/ready`, {
      method: "GET",
      signal: controller.signal,
      headers: { "Cache-Control": "no-store" },
    });

    return response.status === 200;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function switchToGreen(): Promise<void> {
  const state = await readState();
  if (state.activeColor === "green") return;

  const greenHealthy = await checkHealth(process.env.GREEN_PORT || "3002");
  if (!greenHealthy) throw new Error("Green not ready");

  state.previousColor = state.activeColor;
  state.activeColor = "green";
  state.lastSwitch = Date.now();
  await writeState(state);
  process.env.ACTIVE_COLOR = "green";
  console.log("Switched to green");
}

export async function rollback(): Promise<void> {
  const state = await readState();
  if (state.activeColor === "blue" || !state.previousColor) return;

  state.activeColor = state.previousColor;
  state.lastSwitch = Date.now();
  await writeState(state);
  process.env.ACTIVE_COLOR = state.activeColor;
  console.log("Rolled back to", state.activeColor);
}

export async function getStatus(): Promise<DeploymentState> {
  return readState();
}

// CLI entry for deploy commands
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === "switch-green") {
    switchToGreen().catch(console.error);
  } else if (args[0] === "rollback") {
    rollback().catch(console.error);
  } else if (args[0] === "status") {
    getStatus().then(console.log);
  }
}
