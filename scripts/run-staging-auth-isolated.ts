import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildStagingAuthChildEnv, type StagingAuthCommand } from "../server/stagingAuth/isolation";

const command = process.argv[2] as StagingAuthCommand | undefined;
if (!command || !["server", "migrate", "migrate-003", "migrate-meta-binding", "migrate-recovery", "seed", "preflight"].includes(command)) {
  console.error("Usage: run-staging-auth-isolated.ts <server|migrate|migrate-003|migrate-meta-binding|migrate-recovery|seed|preflight>");
  process.exit(2);
}

let env: NodeJS.ProcessEnv;
try {
  env = buildStagingAuthChildEnv(process.env, command);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Staging auth isolation failed.");
  process.exit(1);
}

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(
  workspaceRoot,
  "server/stagingAuth",
  command === "server"
    ? "server.ts"
    : command === "migrate-recovery"
      ? "../../scripts/staging-auth-password-recovery-setup.ts"
      : command === "migrate-meta-binding"
        ? "migrate-meta-binding-004.ts"
        : `${command}.ts`,
);
const tsx = path.join(workspaceRoot, "node_modules/.bin/tsx");
const child = spawn(tsx, [entry, ...process.argv.slice(3)], {
  cwd: workspaceRoot,
  env,
  stdio: "inherit",
});

child.on("error", () => {
  console.error("Staging auth child process could not start.");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
