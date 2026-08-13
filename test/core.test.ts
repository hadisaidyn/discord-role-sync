import { describe, expect, it, vi } from "vitest";

import { syncParticipants } from "../src/core.js";
import type { MemberSnapshot, Participant, RoleAdapter } from "../src/types.js";

function participant(id: string, label: string): Participant {
  return {
    id,
    label,
    bot: false,
    sources: new Set(["reaction ✅", "poll answer 1"]),
  };
}

function adapterFor(
  members: Record<string, MemberSnapshot | null>,
): RoleAdapter {
  return {
    fetchMember: vi.fn(async (id: string) => members[id] ?? null),
    addRole: vi.fn(async () => undefined),
    removeRole: vi.fn(async () => undefined),
  };
}

describe("syncParticipants", () => {
  it("adds only members who do not already have the role", async () => {
    const adapter = adapterFor({
      "1": { id: "1", label: "Ada", hasRole: false },
      "2": { id: "2", label: "Lin", hasRole: true },
    });
    const summary = await syncParticipants({
      action: "ADD",
      dryRun: false,
      participants: [participant("1", "Ada"), participant("2", "Lin")],
      adapter,
      log: vi.fn(),
    });

    expect(summary).toEqual({
      discovered: 2,
      changed: 1,
      unchanged: 1,
      notInGuild: 0,
      failed: 0,
    });
    expect(adapter.addRole).toHaveBeenCalledOnce();
    expect(adapter.removeRole).not.toHaveBeenCalled();
  });

  it("removes only members who currently have the role", async () => {
    const adapter = adapterFor({
      "1": { id: "1", label: "Ada", hasRole: true },
    });
    const summary = await syncParticipants({
      action: "REMOVE",
      dryRun: false,
      participants: [participant("1", "Ada")],
      adapter,
      log: vi.fn(),
    });
    expect(summary.changed).toBe(1);
    expect(adapter.removeRole).toHaveBeenCalledOnce();
  });

  it("reports departed members and continues", async () => {
    const adapter = adapterFor({ "1": null });
    const summary = await syncParticipants({
      action: "ADD",
      dryRun: false,
      participants: [participant("1", "Ada")],
      adapter,
      log: vi.fn(),
    });
    expect(summary.notInGuild).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("does not mutate Discord in dry-run mode", async () => {
    const adapter = adapterFor({
      "1": { id: "1", label: "Ada", hasRole: false },
    });
    const summary = await syncParticipants({
      action: "ADD",
      dryRun: true,
      participants: [participant("1", "Ada")],
      adapter,
      log: vi.fn(),
    });
    expect(summary.changed).toBe(1);
    expect(adapter.addRole).not.toHaveBeenCalled();
  });

  it("isolates per-member failures and keeps processing", async () => {
    const adapter = adapterFor({
      "1": { id: "1", label: "Ada", hasRole: false },
      "2": { id: "2", label: "Lin", hasRole: false },
    });
    vi.mocked(adapter.addRole)
      .mockRejectedValueOnce(new Error("hierarchy"))
      .mockResolvedValueOnce(undefined);
    const summary = await syncParticipants({
      action: "ADD",
      dryRun: false,
      participants: [participant("1", "Ada"), participant("2", "Lin")],
      adapter,
      log: vi.fn(),
    });
    expect(summary.failed).toBe(1);
    expect(summary.changed).toBe(1);
  });
});
