export type Action = "ADD" | "REMOVE";

export interface Config {
  token: string;
  guildId: string;
  messageId: string;
  roleId: string;
  action: Action;
  channelId?: string;
  dryRun: boolean;
  includeBots: boolean;
}

export interface Participant {
  id: string;
  label: string;
  bot: boolean;
  sources: Set<string>;
}

export interface MemberSnapshot {
  id: string;
  label: string;
  hasRole: boolean;
}

export interface RoleAdapter {
  fetchMember(userId: string): Promise<MemberSnapshot | null>;
  addRole(member: MemberSnapshot): Promise<void>;
  removeRole(member: MemberSnapshot): Promise<void>;
}

export interface SyncSummary {
  discovered: number;
  changed: number;
  unchanged: number;
  notInGuild: number;
  failed: number;
}

export type Log = (message: string) => void;
