import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/cli.js";

const VALID_ENV = {
  DISCORD_TOKEN: "token",
  DISCORD_GUILD_ID: "123456789012345678",
  DISCORD_MESSAGE_ID: "223456789012345678",
  DISCORD_ROLE_ID: "323456789012345678",
  DISCORD_ACTION: "add",
};

describe("loadConfig", () => {
  it("loads and normalizes environment values", () => {
    expect(loadConfig([], VALID_ENV)).toEqual({
      token: "token",
      guildId: "123456789012345678",
      messageId: "223456789012345678",
      roleId: "323456789012345678",
      action: "ADD",
      dryRun: true,
      includeBots: false,
    });
  });

  it("lets command-line values override non-secret environment values", () => {
    const config = loadConfig(
      ["--action", "REMOVE", "--channel-id", "423456789012345678", "--apply"],
      VALID_ENV,
    );
    expect(config.action).toBe("REMOVE");
    expect(config.channelId).toBe("423456789012345678");
    expect(config.dryRun).toBe(false);
  });

  it("never accepts the token as a command-line argument", () => {
    expect(() => loadConfig(["--token", "visible"], VALID_ENV)).toThrow(
      "Unknown option: --token",
    );
  });

  it("rejects invalid Discord IDs", () => {
    expect(() =>
      loadConfig([], { ...VALID_ENV, DISCORD_ROLE_ID: "not-an-id" }),
    ).toThrow("17–20 digit Discord ID");
  });

  it("rejects conflicting execution modes", () => {
    expect(() => loadConfig(["--dry-run", "--apply"], VALID_ENV)).toThrow(
      "cannot be used together",
    );
  });
});
