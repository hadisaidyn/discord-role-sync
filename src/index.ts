import { loadEnvFile } from "node:process";

import { HELP, loadConfig, wantsHelp } from "./cli.js";
import { formatError } from "./core.js";
import { runDiscordRoleSync } from "./discord.js";

try {
  loadEnvFile();
} catch (error) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : undefined;
  if (code !== "ENOENT") throw error;
}

if (wantsHelp(process.argv.slice(2))) {
  console.log(HELP);
  process.exit(0);
}

try {
  const config = loadConfig(process.argv.slice(2), process.env);
  const summary = await runDiscordRoleSync(config, console.log);
  const prefix = config.dryRun ? "Preview" : "Done";
  const changeText = config.dryRun
    ? `${summary.changed} would change`
    : `${summary.changed} changed`;
  console.log(
    `${prefix}: ${changeText}, ${summary.unchanged} unchanged, ` +
      `${summary.notInGuild} no longer in server, ${summary.failed} failed ` +
      `(from ${summary.discovered} participant(s)).`,
  );
  if (summary.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Error: ${formatError(error)}`);
  process.exitCode = 1;
}
