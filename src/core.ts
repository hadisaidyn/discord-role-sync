import type {
  Action,
  Log,
  Participant,
  RoleAdapter,
  SyncSummary,
} from "./types.js";

export interface SyncOptions {
  action: Action;
  dryRun: boolean;
  participants: Iterable<Participant>;
  adapter: RoleAdapter;
  log: Log;
}

export async function syncParticipants({
  action,
  dryRun,
  participants,
  adapter,
  log,
}: SyncOptions): Promise<SyncSummary> {
  const participantList = [...participants].sort((left, right) =>
    left.label.localeCompare(right.label),
  );
  const summary: SyncSummary = {
    discovered: participantList.length,
    changed: 0,
    unchanged: 0,
    notInGuild: 0,
    failed: 0,
  };

  for (const participant of participantList) {
    const sourceList = [...participant.sources].join(", ");
    let member;
    try {
      member = await adapter.fetchMember(participant.id);
    } catch (error) {
      summary.failed += 1;
      log(
        `[ERROR] ${participant.label} (${participant.id}) — could not fetch member: ${formatError(error)}`,
      );
      continue;
    }

    if (member === null) {
      summary.notInGuild += 1;
      log(
        `[SKIP] ${participant.label} (${participant.id}) — no longer in the server; source: ${sourceList}`,
      );
      continue;
    }

    const shouldChange = action === "ADD" ? !member.hasRole : member.hasRole;
    if (!shouldChange) {
      summary.unchanged += 1;
      const state =
        action === "ADD" ? "already has the role" : "does not have the role";
      log(
        `[SKIP] ${member.label} (${member.id}) — ${state}; source: ${sourceList}`,
      );
      continue;
    }

    if (dryRun) {
      summary.changed += 1;
      log(
        `[DRY RUN] ${action} role ${action === "ADD" ? "to" : "from"} ${member.label} (${member.id}); source: ${sourceList}`,
      );
      continue;
    }

    try {
      if (action === "ADD") {
        await adapter.addRole(member);
      } else {
        await adapter.removeRole(member);
      }
      summary.changed += 1;
      log(`[${action}] ${member.label} (${member.id}); source: ${sourceList}`);
    } catch (error) {
      summary.failed += 1;
      log(
        `[ERROR] ${member.label} (${member.id}) — role update failed: ${formatError(error)}`,
      );
    }
  }

  return summary;
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
