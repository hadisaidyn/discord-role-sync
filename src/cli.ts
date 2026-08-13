import type { Action, Config } from "./types.js";

const SNOWFLAKE = /^\d{17,20}$/;

export const HELP = `discord-role-sync

Synchronize a Discord role with everyone who reacted to a message or voted in
its native Discord poll. The command runs once and exits; it is not a bot daemon.

Usage:
  npm start -- --guild-id ID --message-id ID --role-id ID --action ADD [options]

Required (CLI option or environment variable):
  --guild-id ID      DISCORD_GUILD_ID     Discord server/guild ID
  --message-id ID    DISCORD_MESSAGE_ID   Source message ID
  --role-id ID       DISCORD_ROLE_ID      Role to add or remove
  --action ACTION    DISCORD_ACTION       ADD or REMOVE
                     DISCORD_TOKEN        Bot token (environment only)

Options:
  --channel-id ID    DISCORD_CHANNEL_ID   Source channel (recommended)
  --dry-run                               Report changes (the safe default)
  --apply                                 Actually add or remove the role
  --include-bots                          Include bot users in the participant set
  -h, --help                              Show this help
`;

interface ParsedArgs {
  values: Map<string, string>;
  flags: Set<string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  const valueOptions = new Set([
    "--guild-id",
    "--message-id",
    "--role-id",
    "--action",
    "--channel-id",
  ]);
  const flagOptions = new Set([
    "--dry-run",
    "--apply",
    "--include-bots",
    "--help",
    "-h",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === undefined) continue;

    if (flagOptions.has(current)) {
      flags.add(current);
      continue;
    }

    if (!valueOptions.has(current)) {
      throw new Error(`Unknown option: ${current}`);
    }

    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${current}`);
    }

    values.set(current, value);
    index += 1;
  }

  return { values, flags };
}

function requiredValue(
  args: ParsedArgs,
  option: string,
  environmentName: string,
  env: NodeJS.ProcessEnv,
): string {
  const value = args.values.get(option) ?? env[environmentName];
  if (!value?.trim()) {
    throw new Error(`Missing ${option} (or ${environmentName})`);
  }
  return value.trim();
}

function validateSnowflake(name: string, value: string): string {
  if (!SNOWFLAKE.test(value)) {
    throw new Error(`${name} must be a 17–20 digit Discord ID`);
  }
  return value;
}

function parseAction(value: string): Action {
  const normalized = value.toUpperCase();
  if (normalized !== "ADD" && normalized !== "REMOVE") {
    throw new Error(`--action must be ADD or REMOVE (received ${value})`);
  }
  return normalized;
}

export function wantsHelp(argv: string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function loadConfig(argv: string[], env: NodeJS.ProcessEnv): Config {
  const args = parseArgs(argv);
  if (args.flags.has("--dry-run") && args.flags.has("--apply")) {
    throw new Error("--dry-run and --apply cannot be used together");
  }
  const token = env.DISCORD_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "Missing DISCORD_TOKEN; bot tokens are accepted only through the environment",
    );
  }

  const channelId =
    args.values.get("--channel-id") ?? env.DISCORD_CHANNEL_ID?.trim();

  return {
    token,
    guildId: validateSnowflake(
      "--guild-id",
      requiredValue(args, "--guild-id", "DISCORD_GUILD_ID", env),
    ),
    messageId: validateSnowflake(
      "--message-id",
      requiredValue(args, "--message-id", "DISCORD_MESSAGE_ID", env),
    ),
    roleId: validateSnowflake(
      "--role-id",
      requiredValue(args, "--role-id", "DISCORD_ROLE_ID", env),
    ),
    action: parseAction(requiredValue(args, "--action", "DISCORD_ACTION", env)),
    ...(channelId
      ? { channelId: validateSnowflake("--channel-id", channelId) }
      : {}),
    dryRun: !args.flags.has("--apply"),
    includeBots: args.flags.has("--include-bots"),
  };
}
