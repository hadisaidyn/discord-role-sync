import {
  Collection,
  PermissionFlagsBits,
  ReactionType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type Role,
  type User,
} from "discord.js";
import { describe, expect, it, vi } from "vitest";

import {
  assertRoleCanBeManaged,
  collectParticipants,
  findMessage,
} from "../src/discord.js";

interface ReactionFetchOptions {
  type: ReactionType;
  limit: number;
  after?: string;
}

interface PollFetchOptions {
  messageId: string;
  answerId: number;
  limit: number;
  after?: string;
}

function user(id: string, bot = false): User {
  return {
    id,
    tag: `${id}#0001`,
    bot,
  } as User;
}

function userSeries(prefix: string, count: number, start = 0): User[] {
  return Array.from({ length: count }, (_, index) =>
    user(`${prefix}-${(index + start).toString().padStart(3, "0")}`),
  );
}

function page(users: User[]): Collection<string, User> {
  return new Collection(users.map((entry) => [entry.id, entry]));
}

function message(id = "message-1"): Message<true> {
  return { id } as Message<true>;
}

function messageChannel(
  id: string,
  name: string,
  fetchMessage: (messageId: string) => Promise<Message<true>>,
): GuildBasedChannel {
  return {
    id,
    name,
    isTextBased: () => true,
    messages: { fetch: fetchMessage },
  } as unknown as GuildBasedChannel;
}

function guildWithChannels(
  channels: GuildBasedChannel[],
  activeThreads: GuildBasedChannel[] = [],
): {
  guild: Guild;
  fetchChannels: ReturnType<typeof vi.fn>;
  fetchActiveThreads: ReturnType<typeof vi.fn>;
} {
  const allChannels = new Map(
    [...channels, ...activeThreads].map((channel) => [channel.id, channel]),
  );
  const fetchChannels = vi.fn(async (channelId?: string) => {
    if (channelId !== undefined) return allChannels.get(channelId) ?? null;
    return new Collection(channels.map((channel) => [channel.id, channel]));
  });
  const fetchActiveThreads = vi.fn(async () => ({
    threads: new Collection(activeThreads.map((thread) => [thread.id, thread])),
  }));
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
    channels: {
      fetch: fetchChannels,
      fetchActiveThreads,
    },
  } as unknown as Guild;
  return { guild, fetchChannels, fetchActiveThreads };
}

function discordApiError(code: number, text = `Discord error ${code}`): Error {
  return Object.assign(new Error(text), { code });
}

function rolePreflightFixture(
  options: {
    roleId?: string;
    managed?: boolean;
    hasManageRoles?: boolean;
    hierarchyComparison?: number;
  } = {},
): {
  guild: Guild;
  botMember: GuildMember;
  role: Role;
  hasPermission: ReturnType<typeof vi.fn>;
  comparePositionTo: ReturnType<typeof vi.fn>;
} {
  const guild = {
    id: "guild-1",
    ownerId: "owner-1",
  } as Guild;
  const hasPermission = vi.fn(
    (permission: bigint) =>
      permission === PermissionFlagsBits.ManageRoles &&
      (options.hasManageRoles ?? true),
  );
  const comparePositionTo = vi.fn(() => options.hierarchyComparison ?? 1);
  const botMember = {
    id: "bot-1",
    permissions: { has: hasPermission },
    roles: { highest: { comparePositionTo } },
  } as unknown as GuildMember;
  const role = {
    id: options.roleId ?? "role-1",
    managed: options.managed ?? false,
  } as Role;
  return { guild, botMember, role, hasPermission, comparePositionTo };
}

function messageWith(options: {
  reactionFetch?: (
    options: ReactionFetchOptions,
  ) => Promise<Collection<string, User>>;
  normalCount?: number;
  burstCount?: number;
  pollAnswerIds?: number[];
  pollFetch?: (options: PollFetchOptions) => Promise<Collection<string, User>>;
}): Message<true> {
  const reactionFetch = options.reactionFetch;
  const reactionCache = reactionFetch
    ? new Collection([
        [
          "fire",
          {
            count: (options.normalCount ?? 0) + (options.burstCount ?? 0),
            countDetails: {
              normal: options.normalCount ?? 0,
              burst: options.burstCount ?? 0,
            },
            emoji: { toString: () => "🔥" },
            users: { fetch: reactionFetch },
          },
        ],
      ])
    : new Collection();
  const answerIds = options.pollAnswerIds ?? [];

  return {
    id: "message-1",
    reactions: { cache: reactionCache },
    poll:
      answerIds.length === 0
        ? null
        : {
            answers: new Collection(
              answerIds.map((answerId) => [answerId, { id: answerId }]),
            ),
          },
    channel: {
      messages: {
        fetchPollAnswerVoters:
          options.pollFetch ?? (async () => new Collection<string, User>()),
      },
    },
  } as unknown as Message<true>;
}

describe("findMessage", () => {
  it("fetches directly from a supplied channel", async () => {
    const expected = message();
    const fetchMessage = vi.fn(async () => expected);
    const channel = messageChannel("channel-1", "general", fetchMessage);
    const { guild, fetchChannels, fetchActiveThreads } = guildWithChannels([
      channel,
    ]);

    const found = await findMessage(guild, expected.id, channel.id, vi.fn());

    expect(found).toBe(expected);
    expect(fetchChannels).toHaveBeenCalledWith(channel.id);
    expect(fetchMessage).toHaveBeenCalledWith(expected.id);
    expect(fetchActiveThreads).not.toHaveBeenCalled();
  });

  it("wraps a supplied channel's message-fetch error with identifiers", async () => {
    const fetchMessage = vi.fn(async () => {
      throw new Error("missing access");
    });
    const channel = messageChannel("channel-1", "general", fetchMessage);
    const { guild } = guildWithChannels([channel]);

    await expect(
      findMessage(guild, "message-9", channel.id, vi.fn()),
    ).rejects.toThrow(
      "Could not fetch message message-9 from channel channel-1: missing access",
    );
  });

  it.each([10_008, 50_001, 50_013])(
    "suppresses expected lookup error code %i while auto-scanning",
    async (code) => {
      const expected = message();
      const missFetch = vi.fn(async () => {
        throw discordApiError(code);
      });
      const foundFetch = vi.fn(async () => expected);
      const miss = messageChannel("channel-miss", "miss", missFetch);
      const match = messageChannel("channel-match", "match", foundFetch);
      const { guild } = guildWithChannels([miss, match]);

      const found = await findMessage(guild, expected.id, undefined, vi.fn());

      expect(found).toBe(expected);
      expect(missFetch).toHaveBeenCalledOnce();
      expect(foundFetch).toHaveBeenCalledOnce();
    },
  );

  it("surfaces unexpected errors immediately while auto-scanning", async () => {
    const unexpected = discordApiError(40_001, "authentication failed");
    const failingFetch = vi.fn(async () => {
      throw unexpected;
    });
    const laterFetch = vi.fn(async () => message());
    const first = messageChannel("channel-first", "first", failingFetch);
    const later = messageChannel("channel-later", "later", laterFetch);
    const { guild } = guildWithChannels([first, later]);

    await expect(
      findMessage(guild, "message-1", undefined, vi.fn()),
    ).rejects.toBe(unexpected);
    expect(laterFetch).not.toHaveBeenCalled();
  });

  it("discovers messages inside active threads", async () => {
    const expected = message();
    const fetchMessage = vi.fn(async () => expected);
    const thread = messageChannel("thread-1", "support-thread", fetchMessage);
    const { guild, fetchActiveThreads } = guildWithChannels([], [thread]);
    const log = vi.fn();

    const found = await findMessage(guild, expected.id, undefined, log);

    expect(found).toBe(expected);
    expect(fetchActiveThreads).toHaveBeenCalledOnce();
    expect(fetchMessage).toHaveBeenCalledWith(expected.id);
    expect(log).toHaveBeenCalledWith(
      "Found message in #support-thread (thread-1)",
    );
  });
});

describe("assertRoleCanBeManaged", () => {
  it("rejects @everyone when applying and warns during a dry run", () => {
    const fixture = rolePreflightFixture({ roleId: "guild-1" });

    expect(() =>
      assertRoleCanBeManaged(
        fixture.guild,
        fixture.botMember,
        fixture.role,
        false,
        vi.fn(),
      ),
    ).toThrow("the @everyone role cannot be changed");

    const log = vi.fn();
    expect(() =>
      assertRoleCanBeManaged(
        fixture.guild,
        fixture.botMember,
        fixture.role,
        true,
        log,
      ),
    ).not.toThrow();
    expect(log).toHaveBeenCalledWith(
      "[WARNING] Role preflight failed: the @everyone role cannot be changed",
    );
  });

  it("rejects roles managed by an integration", () => {
    const fixture = rolePreflightFixture({ managed: true });

    expect(() =>
      assertRoleCanBeManaged(
        fixture.guild,
        fixture.botMember,
        fixture.role,
        false,
        vi.fn(),
      ),
    ).toThrow("the target role is managed by an integration");
  });

  it("rejects a bot without Manage Roles permission", () => {
    const fixture = rolePreflightFixture({ hasManageRoles: false });

    expect(() =>
      assertRoleCanBeManaged(
        fixture.guild,
        fixture.botMember,
        fixture.role,
        false,
        vi.fn(),
      ),
    ).toThrow("the bot lacks the Manage Roles permission");
    expect(fixture.hasPermission).toHaveBeenCalledWith(
      PermissionFlagsBits.ManageRoles,
    );
  });

  it("rejects a role at or above the bot's highest role", () => {
    const fixture = rolePreflightFixture({ hierarchyComparison: 0 });

    expect(() =>
      assertRoleCanBeManaged(
        fixture.guild,
        fixture.botMember,
        fixture.role,
        false,
        vi.fn(),
      ),
    ).toThrow("the bot's highest role is not above the target role");
    expect(fixture.comparePositionTo).toHaveBeenCalledWith(fixture.role);
  });
});

describe("collectParticipants", () => {
  it("paginates normal and super reaction users independently", async () => {
    const normalFirst = userSeries("normal", 100);
    const normalSecond = userSeries("normal", 100, 100);
    const normalLast = userSeries("normal", 5, 200);
    const burstFirst = userSeries("burst", 100);
    const burstLast = user("burst-100");
    const fetchReactionUsers = vi.fn(async (options: ReactionFetchOptions) => {
      if (options.type === ReactionType.Normal) {
        if (!options.after) return page(normalFirst);
        if (options.after === "normal-099") return page(normalSecond);
        if (options.after === "normal-199") return page(normalLast);
        throw new Error(`Unexpected normal cursor: ${options.after}`);
      }
      if (!options.after) return page(burstFirst);
      if (options.after === "burst-099") return page([burstLast]);
      throw new Error(`Unexpected burst cursor: ${options.after}`);
    });
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 205,
      burstCount: 101,
    });

    const participants = await collectParticipants(message, false, vi.fn());

    expect(participants).toHaveLength(306);
    expect(fetchReactionUsers.mock.calls.map(([call]) => call)).toEqual([
      { type: ReactionType.Normal, limit: 100 },
      {
        type: ReactionType.Normal,
        limit: 100,
        after: "normal-099",
      },
      {
        type: ReactionType.Normal,
        limit: 100,
        after: "normal-199",
      },
      { type: ReactionType.Burst, limit: 100 },
      { type: ReactionType.Burst, limit: 100, after: "burst-099" },
    ]);
    expect(participants.get("normal-204")?.sources).toEqual(
      new Set(["normal reaction 🔥"]),
    );
    expect(participants.get(burstLast.id)?.sources).toEqual(
      new Set(["super reaction 🔥"]),
    );
  });

  it("stops cleanly after an empty terminal reaction page", async () => {
    const firstPage = userSeries("exact-page", 100);
    const fetchReactionUsers = vi.fn(async (options: ReactionFetchOptions) =>
      options.after ? page([]) : page(firstPage),
    );
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 100,
    });

    const participants = await collectParticipants(message, false, vi.fn());

    expect(participants).toHaveLength(100);
    expect(fetchReactionUsers.mock.calls.map(([call]) => call)).toEqual([
      { type: ReactionType.Normal, limit: 100 },
      {
        type: ReactionType.Normal,
        limit: 100,
        after: "exact-page-099",
      },
    ]);
  });

  it("unions reaction users with paginated poll voters and deduplicates sources", async () => {
    const shared = user("shared");
    const reactionOnly = user("reaction-only");
    const excludedBot = user("bot", true);
    const firstPollPage = [shared, excludedBot, ...userSeries("poll", 98)];
    const pollTail = user("poll-tail");
    const secondAnswerOnly = user("answer-two-only");
    const fetchReactionUsers = vi.fn(async () => page([shared, reactionOnly]));
    const fetchPollAnswerVoters = vi.fn(async (options: PollFetchOptions) => {
      if (options.answerId === 1) {
        return options.after ? page([pollTail]) : page(firstPollPage);
      }
      return page([shared, secondAnswerOnly]);
    });
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 2,
      pollAnswerIds: [1, 2],
      pollFetch: fetchPollAnswerVoters,
    });

    const participants = await collectParticipants(message, false, vi.fn());

    expect(participants.has(excludedBot.id)).toBe(false);
    expect(participants.get(shared.id)?.sources).toEqual(
      new Set(["normal reaction 🔥", "poll answer 1", "poll answer 2"]),
    );
    expect(participants.get(reactionOnly.id)?.sources).toEqual(
      new Set(["normal reaction 🔥"]),
    );
    expect(participants.get(pollTail.id)?.sources).toEqual(
      new Set(["poll answer 1"]),
    );
    expect(participants.get(secondAnswerOnly.id)?.sources).toEqual(
      new Set(["poll answer 2"]),
    );
    expect(fetchPollAnswerVoters.mock.calls.map(([call]) => call)).toEqual([
      { messageId: "message-1", answerId: 1, limit: 100 },
      {
        messageId: "message-1",
        answerId: 1,
        limit: 100,
        after: "poll-097",
      },
      { messageId: "message-1", answerId: 2, limit: 100 },
    ]);
  });

  it("excludes bots by default and includes them only when requested", async () => {
    const human = user("human");
    const bot = user("helper-bot", true);
    const fetchReactionUsers = vi.fn(async () => page([human, bot]));
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 2,
    });

    const withoutBots = await collectParticipants(message, false, vi.fn());
    const withBots = await collectParticipants(message, true, vi.fn());

    expect([...withoutBots.keys()]).toEqual([human.id]);
    expect([...withBots.keys()]).toEqual([human.id, bot.id]);
    expect(withBots.get(bot.id)).toMatchObject({
      id: bot.id,
      label: bot.tag,
      bot: true,
    });
  });

  it("propagates a rejected reaction-user fetch", async () => {
    const fetchReactionUsers = vi.fn(async () => {
      throw new Error("reaction API unavailable");
    });
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 1,
    });

    await expect(collectParticipants(message, false, vi.fn())).rejects.toThrow(
      "reaction API unavailable",
    );
  });

  it("propagates a rejected poll-voter fetch after reactions were collected", async () => {
    const fetchReactionUsers = vi.fn(async () => page([user("reaction-user")]));
    const fetchPollAnswerVoters = vi.fn(async () => {
      throw new Error("poll API unavailable");
    });
    const message = messageWith({
      reactionFetch: fetchReactionUsers,
      normalCount: 1,
      pollAnswerIds: [1],
      pollFetch: fetchPollAnswerVoters,
    });

    await expect(collectParticipants(message, false, vi.fn())).rejects.toThrow(
      "poll API unavailable",
    );
    expect(fetchReactionUsers).toHaveBeenCalledOnce();
    expect(fetchPollAnswerVoters).toHaveBeenCalledOnce();
  });
});
