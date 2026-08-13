import {
  Client,
  Collection,
  GatewayIntentBits,
  PermissionFlagsBits,
  ReactionType,
  type Guild,
  type GuildBasedChannel,
  type GuildMember,
  type Message,
  type Role,
  type User,
} from "discord.js";

import { formatError, syncParticipants } from "./core.js";
import type {
  Config,
  Log,
  MemberSnapshot,
  Participant,
  RoleAdapter,
  SyncSummary,
} from "./types.js";

type MessageChannel = GuildBasedChannel & {
  messages: {
    fetch(messageId: string): Promise<Message<true>>;
    fetchPollAnswerVoters(options: {
      messageId: string;
      answerId: number;
      limit: number;
      after?: string;
    }): Promise<Collection<string, User>>;
  };
};

const UNKNOWN_MESSAGE = 10_008;
const MISSING_ACCESS = 50_001;
const MISSING_PERMISSIONS = 50_013;

function discordErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = Number(error.code);
  return Number.isFinite(code) ? code : undefined;
}

function isExpectedLookupMiss(error: unknown): boolean {
  const code = discordErrorCode(error);
  return (
    code === UNKNOWN_MESSAGE ||
    code === MISSING_ACCESS ||
    code === MISSING_PERMISSIONS
  );
}

function supportsMessages(
  channel: GuildBasedChannel | null,
): channel is MessageChannel {
  return channel !== null && channel.isTextBased() && "messages" in channel;
}

export async function findMessage(
  guild: Guild,
  messageId: string,
  channelId: string | undefined,
  log: Log,
): Promise<Message<true>> {
  if (channelId) {
    const channel = await guild.channels.fetch(channelId);
    if (!supportsMessages(channel)) {
      throw new Error(
        `Channel ${channelId} is not an accessible message channel in this server`,
      );
    }
    try {
      return await channel.messages.fetch(messageId);
    } catch (error) {
      throw new Error(
        `Could not fetch message ${messageId} from channel ${channelId}: ${formatError(error)}`,
      );
    }
  }

  log("No channel ID supplied; searching accessible message channels…");
  const [guildChannels, activeThreads] = await Promise.all([
    guild.channels.fetch(),
    guild.channels.fetchActiveThreads(),
  ]);
  const channels = new Map<string, GuildBasedChannel>();
  for (const channel of guildChannels.values()) {
    if (channel) channels.set(channel.id, channel);
  }
  for (const thread of activeThreads.threads.values()) {
    channels.set(thread.id, thread);
  }

  for (const channel of channels.values()) {
    if (!supportsMessages(channel)) continue;
    try {
      const message = await channel.messages.fetch(messageId);
      log(`Found message in #${channel.name} (${channel.id})`);
      return message;
    } catch (error) {
      // Discord does not provide a guild-wide message lookup, so inaccessible or
      // non-matching channels are expected while searching.
      if (!isExpectedLookupMiss(error)) throw error;
    }
  }

  throw new Error(
    `Message ${messageId} was not found in accessible server channels. Pass --channel-id for threads or large servers.`,
  );
}

function addParticipant(
  participants: Map<string, Participant>,
  user: User,
  source: string,
  includeBots: boolean,
): void {
  if (user.bot && !includeBots) return;
  const existing = participants.get(user.id);
  if (existing) {
    existing.sources.add(source);
    return;
  }
  participants.set(user.id, {
    id: user.id,
    label: user.tag,
    bot: user.bot,
    sources: new Set([source]),
  });
}

async function collectReactionUsers(
  message: Message<true>,
  participants: Map<string, Participant>,
  includeBots: boolean,
  log: Log,
): Promise<void> {
  let fetchedSources = 0;
  for (const reaction of message.reactions.cache.values()) {
    const reactionTypes: Array<{ label: string; type: ReactionType }> = [];
    if (reaction.countDetails.normal > 0) {
      reactionTypes.push({ label: "normal", type: ReactionType.Normal });
    }
    if (reaction.countDetails.burst > 0) {
      reactionTypes.push({ label: "super", type: ReactionType.Burst });
    }

    // Older or incomplete payloads may not include count_details. A non-empty
    // reaction still needs a best-effort normal-reaction fetch in that case.
    if (reactionTypes.length === 0 && (reaction.count ?? 0) > 0) {
      reactionTypes.push({ label: "normal", type: ReactionType.Normal });
    }

    for (const reactionType of reactionTypes) {
      fetchedSources += 1;
      let after: string | undefined;
      let fetched = 0;
      do {
        const page = await reaction.users.fetch({
          type: reactionType.type,
          limit: 100,
          ...(after ? { after } : {}),
        });
        for (const user of page.values()) {
          addParticipant(
            participants,
            user,
            `${reactionType.label} reaction ${reaction.emoji.toString()}`,
            includeBots,
          );
        }
        fetched = page.size;
        after = page.lastKey();
      } while (fetched === 100 && after !== undefined);
    }
  }
  log(
    `Collected participants from ${fetchedSources} reaction source(s) across ${message.reactions.cache.size} emoji(s)`,
  );
}

async function collectPollVoters(
  message: Message<true>,
  participants: Map<string, Participant>,
  includeBots: boolean,
  log: Log,
): Promise<void> {
  if (!message.poll) return;

  for (const answer of message.poll.answers.values()) {
    let after: string | undefined;
    let fetched = 0;
    do {
      const page = await message.channel.messages.fetchPollAnswerVoters({
        messageId: message.id,
        answerId: answer.id,
        limit: 100,
        ...(after ? { after } : {}),
      });
      for (const user of page.values()) {
        addParticipant(
          participants,
          user,
          `poll answer ${answer.id}`,
          includeBots,
        );
      }
      fetched = page.size;
      after = page.lastKey();
    } while (fetched === 100 && after !== undefined);
  }
  log(
    `Collected participants from ${message.poll.answers.size} poll answer(s)`,
  );
}

export async function collectParticipants(
  message: Message<true>,
  includeBots: boolean,
  log: Log,
): Promise<Map<string, Participant>> {
  const participants = new Map<string, Participant>();
  await collectReactionUsers(message, participants, includeBots, log);
  await collectPollVoters(message, participants, includeBots, log);
  return participants;
}

export function assertRoleCanBeManaged(
  guild: Guild,
  botMember: GuildMember,
  role: Role,
  dryRun: boolean,
  log: Log,
): void {
  const problems: string[] = [];
  if (role.id === guild.id)
    problems.push("the @everyone role cannot be changed");
  if (role.managed)
    problems.push("the target role is managed by an integration");
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
    problems.push("the bot lacks the Manage Roles permission");
  }
  if (
    guild.ownerId !== botMember.id &&
    botMember.roles.highest.comparePositionTo(role) <= 0
  ) {
    problems.push("the bot's highest role is not above the target role");
  }
  if (problems.length === 0) return;

  const message = `Role preflight failed: ${problems.join("; ")}`;
  if (dryRun) log(`[PREVIEW BLOCKED] ${message}`);
  throw new Error(message);
}

function createRoleAdapter(
  guild: Guild,
  role: Role,
  reason: string,
): RoleAdapter {
  const memberCache = new Map<string, GuildMember>();

  return {
    async fetchMember(userId: string): Promise<MemberSnapshot | null> {
      try {
        const member = await guild.members.fetch(userId);
        memberCache.set(userId, member);
        return {
          id: member.id,
          label: member.user.tag,
          hasRole: member.roles.cache.has(role.id),
        };
      } catch (error) {
        const code =
          typeof error === "object" && error !== null && "code" in error
            ? String(error.code)
            : undefined;
        if (code === "10007") return null;
        throw error;
      }
    },
    async addRole(member: MemberSnapshot): Promise<void> {
      const guildMember = memberCache.get(member.id);
      if (!guildMember) throw new Error("Member cache invariant failed");
      await guildMember.roles.add(role.id, reason);
    },
    async removeRole(member: MemberSnapshot): Promise<void> {
      const guildMember = memberCache.get(member.id);
      if (!guildMember) throw new Error("Member cache invariant failed");
      await guildMember.roles.remove(role.id, reason);
    },
  };
}

export async function runDiscordRoleSync(
  config: Config,
  log: Log,
): Promise<SyncSummary> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent],
  });
  try {
    await client.login(config.token);
    const guild = await client.guilds.fetch(config.guildId);
    const [role, botMember] = await Promise.all([
      guild.roles.fetch(config.roleId),
      guild.members.fetchMe(),
    ]);
    if (!role)
      throw new Error(
        `Role ${config.roleId} does not exist in server ${config.guildId}`,
      );

    assertRoleCanBeManaged(guild, botMember, role, config.dryRun, log);
    const message = await findMessage(
      guild,
      config.messageId,
      config.channelId,
      log,
    );
    const participants = await collectParticipants(
      message,
      config.includeBots,
      log,
    );
    log(`Found ${participants.size} unique participant(s)`);

    return await syncParticipants({
      action: config.action,
      dryRun: config.dryRun,
      participants: participants.values(),
      adapter: createRoleAdapter(
        guild,
        role,
        `One-shot role sync from message ${config.messageId}`,
      ),
      log,
    });
  } finally {
    await client.destroy();
  }
}
