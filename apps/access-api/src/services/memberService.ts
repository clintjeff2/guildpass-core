import { PrismaClient, MembershipState, Role } from "@prisma/client";
import {
  AccessCheckInput,
  AccessDecision,
  RoleContext,
  CreateMembershipInput,
  RenewMembershipInput,
  UpdateMembershipStatusInput,
  MembershipMutationResult,
} from "@guildpass/shared-types";
import { evaluate } from "@guildpass/policy-engine";
import { logEventTx } from "./auditService";

import { config } from "../config";
import { createDefaultCacheService } from "./redisCacheService";
import type { CacheService } from "./cacheService";

const prisma = new PrismaClient();

export class MemberServiceError extends Error {
  constructor(public message: string, public statusCode: number = 400) {
    super(message);
    this.name = "MemberServiceError";
  }
}

function normaliseWallet(wallet: string): string {
  return wallet.toLowerCase();
}

function getNormalizedMembershipState(
  state: string,
  expiresAt?: Date | null,
): string {
  if (expiresAt && expiresAt < new Date()) {
    return "expired";
  }
  return state;
}

function accessDecisionCacheKey({
  communityId,
  wallet,
  resource,
  membershipVersion,
  roleVersion,
  policyVersion,
  resourceVersion,
}: {
  communityId: string;
  wallet: string;
  resource: string;
  membershipVersion: number | null;
  roleVersion: number | null;
  policyVersion: number | null;
  resourceVersion: number | null;
}): string {
  return [
    "accessDecision",
    `c:${communityId}`,
    `w:${wallet}`,
    `r:${resource}`,
    `mv:${membershipVersion ?? 0}`,
    `rv:${roleVersion ?? 0}`,
    `pv:${policyVersion ?? 0}`,
    `rsv:${resourceVersion ?? 0}`,
  ].join("|");
}

function membershipVersionKey(communityId: string) {
  return `accessDecisionVersion:membership|c:${communityId}`;
}
function roleVersionKey(communityId: string) {
  return `accessDecisionVersion:roles|c:${communityId}`;
}
function policyVersionKey(communityId: string) {
  return `accessDecisionVersion:policy|c:${communityId}`;
}
function resourceVersionKey(communityId: string) {
  return `accessDecisionVersion:resource|c:${communityId}`;
}

export function getMemberService(prismaClient: PrismaClient) {
  const cacheService: CacheService = createDefaultCacheService(
    config.accessDecisionCacheEnabled,
    config.redisUrl,
  );

  const versionTtlSeconds = config.accessDecisionCacheVersionTtlSeconds;
  const decisionTtlSeconds = config.accessDecisionCacheTtlSeconds;

  async function getVersionedKeyParts(communityId: string) {
    const [membershipVersion, roleVersion, policyVersion, resourceVersion] =
      await Promise.all([
        cacheService.getIncr(membershipVersionKey(communityId)),
        cacheService.getIncr(roleVersionKey(communityId)),
        cacheService.getIncr(policyVersionKey(communityId)),
        cacheService.getIncr(resourceVersionKey(communityId)),
      ]);

    return {
      membershipVersion,
      roleVersion,
      policyVersion,
      resourceVersion,
    };
  }

  async function bumpMembershipVersion(communityId: string) {
    await cacheService.incr(
      membershipVersionKey(communityId),
      versionTtlSeconds,
    );
  }
  async function bumpRoleVersion(communityId: string) {
    await cacheService.incr(roleVersionKey(communityId), versionTtlSeconds);
  }
  async function bumpPolicyVersion(communityId: string) {
    await cacheService.incr(policyVersionKey(communityId), versionTtlSeconds);
  }
  async function bumpResourceVersion(communityId: string) {
    await cacheService.incr(resourceVersionKey(communityId), versionTtlSeconds);
  }

  async function auditAccess(input: {
    walletId?: string | null;
    communityId?: string | null;
    resource?: string | null;
    policyRule?: string | null;
    decision: "ALLOW" | "DENY";
    reasonCode?: string | null;
    details?: any;
  }) {
    try {
      await logEventTx(prismaClient as any, {
        eventType: "ACCESS_CHECK",
        walletId: input.walletId ?? null,
        communityId: input.communityId ?? null,
        resource: input.resource ?? null,
        policyRule: input.policyRule ?? null,
        decision: input.decision,
        reasonCode: input.reasonCode ?? null,
        beforeState: null,
        afterState: { evaluation: input.details ?? null },
      });
    } catch (err) {
      // Never fail access because audit failed.
      // eslint-disable-next-line no-console
      console.error("Failed to log access audit event:", err);
    }
  }

  async function checkAccess(input: AccessCheckInput): Promise<AccessDecision> {
    const wallet = normaliseWallet(input.wallet);
    const communityId = input.communityId;
    const resource = input.resource;

    const versions = await getVersionedKeyParts(communityId);
    const cacheKey = accessDecisionCacheKey({
      communityId,
      wallet,
      resource,
      ...versions,
    });

    const cached = await cacheService.getJSON<AccessDecision>(cacheKey);
    if (cached) return cached.value;

    const w = await prismaClient.wallet.findUnique({
      where: { address: wallet },
    });

    if (!w) {
      const decision: AccessDecision = {
        allowed: false,
        code: "DENY",
        reasons: [{ code: "NO_WALLET", message: "Wallet not known" }],
        membershipState: "invited",
        effectiveRoles: [],
      };
      await auditAccess({
        walletId: wallet,
        communityId,
        resource,
        policyRule: null,
        decision: "DENY",
        reasonCode: decision.reasons?.[0]?.code ?? null,
      });
      await cacheService.setJSON(cacheKey, decision, decisionTtlSeconds);
      return decision;
    }

    const member = await prismaClient.member.findFirst({
      where: { walletId: w.id, communityId },
      include: { roles: true, membership: true },
    });

    if (!member) {
      const decision: AccessDecision = {
        allowed: false,
        code: "DENY",
        reasons: [
          {
            code: "NOT_MEMBER",
            message: "Wallet is not a member of community",
          },
        ],
        membershipState: "invited",
        effectiveRoles: [],
      };
      await auditAccess({
        walletId: wallet,
        communityId,
        resource,
        policyRule: null,
        decision: "DENY",
        reasonCode: decision.reasons?.[0]?.code ?? null,
      });
      await cacheService.setJSON(cacheKey, decision, decisionTtlSeconds);
      return decision;
    }

    const policy = await prismaClient.accessPolicy.findFirst({
      where: { communityId, resource },
    });

    const ruleType = policy ? policy.ruleType : "MEMBERS_ONLY";

    const effectiveState = getNormalizedMembershipState(
      member.membership?.state ?? "invited",
      member.membership?.expiresAt,
    );

    const ctx: RoleContext = {
      assignments: member.roles.map((r: any) => ({
        role: r.role as any,
        source: r.source as any,
        active: r.active,
      })),
      membershipState: effectiveState as any,
    };

    const decision = evaluate(
      {
        id: policy?.id ?? "default",
        communityId,
        resource,
        ruleType,
        params: policy?.params as Record<string, any> | undefined,
      },
      ctx,
    );

    const reasonCode = decision.reasons?.[0]?.code ?? null;
    const allowedDecision = decision.allowed ? "ALLOW" : "DENY";

    await auditAccess({
      walletId: wallet,
      communityId,
      resource,
      policyRule: policy?.ruleType ?? null,
      decision: allowedDecision,
      reasonCode,
      details: (decision as any).details ?? null,
    });

    await cacheService.setJSON(cacheKey, decision, decisionTtlSeconds);

    return decision;
  }

  async function ensureAdmin(requesterWallet: string, communityId: string) {
    const w = await prismaClient.wallet.findUnique({
      where: { address: normaliseWallet(requesterWallet) },
    });
    if (!w) throw new MemberServiceError("Unauthorized", 403);

    const member = await prismaClient.member.findFirst({
      where: { walletId: w.id, communityId },
      include: { roles: true },
    });

    const isAdmin = member?.roles.some((r: any) => r.role === "admin" && r.active);
    if (!isAdmin) throw new MemberServiceError("Unauthorized", 403);
  }

  return {
    async getMembershipsByWallet(wallet: string, communityId?: string) {
      const w = await prismaClient.wallet.findUnique({
        where: { address: normaliseWallet(wallet) },
      });
      if (!w) return { wallet: normaliseWallet(wallet), communities: [] };
      const members = await prismaClient.member.findMany({
        where: {
          walletId: w.id,
          ...(communityId ? { communityId } : {}),
        },
        include: { membership: true },
      });
      const communities = members.map((m: any) => ({
        communityId: m.communityId,
        state: getNormalizedMembershipState(
          m.membership?.state || "invited",
          m.membership?.expiresAt,
        ),
        expiresAt: m.membership?.expiresAt?.toISOString() ?? null,
      }));
      return { wallet: normaliseWallet(wallet), communities };
    },
    async getProfileByWallet(wallet: string, communityId: string) {
      const w = await prismaClient.wallet.findUnique({
        where: { address: normaliseWallet(wallet) },
      });
      if (!w) return null;
      const m = await prismaClient.member.findFirst({
        where: { walletId: w.id, communityId },
        include: { profile: true, membership: true, roles: true },
      });
      if (!m) return null;
      return {
        wallet: normaliseWallet(wallet),
        communityId: m.communityId,
        profile: {
          id: m.profile?.id ?? "",
          displayName: m.profile?.displayName ?? "",
          bio: m.profile?.bio ?? "",
        },
        membership: {
          state: getNormalizedMembershipState(
            m.membership?.state ?? "invited",
            m.membership?.expiresAt,
          ),
          expiresAt: m.membership?.expiresAt?.toISOString() ?? null,
        },
        roles: m.roles.filter((r: any) => r.active).map((r: any) => r.role),
      };
    },

    checkAccess,

    async listMembersForAdmin(
      communityId: string,
      role?: "admin" | "member" | "contributor",
    ) {
      const members = await prismaClient.member.findMany({
        where: {
          communityId,
          ...(role
            ? { roles: { some: { role: role as Role, active: true } } }
            : {}),
        },
        include: { wallet: true, membership: true, roles: true, profile: true },
      });
      const list = members.map((m: any) => {
        const activeRoles = m.roles
          .filter((r: any) => r.active)
          .map((r: any) => r.role);
        return {
          wallet: m.wallet.address,
          displayName: m.profile?.displayName ?? null,
          state: getNormalizedMembershipState(
            m.membership?.state ?? "invited",
            m.membership?.expiresAt,
          ),
          roles: activeRoles,
        };
      });
      return { communityId, members: list };
    },

    async assignMemberRole(input: {
      requesterWallet: string;
      communityId: string;
      targetWallet: string;
      role: string;
    }) {
      const { requesterWallet, communityId, targetWallet, role } = input;
      if (!["admin", "member", "contributor"].includes(role)) {
        throw new MemberServiceError(`Invalid role: ${role}`, 400);
      }

      await ensureAdmin(requesterWallet, communityId);

      const targetW = await prismaClient.wallet.upsert({
        where: { address: normaliseWallet(targetWallet) },
        update: {},
        create: { address: normaliseWallet(targetWallet) },
      });

      const member = await prismaClient.member.upsert({
        where: {
          communityId_walletId: { communityId, walletId: targetW.id },
        },
        update: {},
        create: { communityId, walletId: targetW.id },
      });

      const existing = await prismaClient.roleAssignment.findFirst({
        where: { memberId: member.id, role: role as Role, active: true },
      });

      if (existing) {
        return {
          communityId,
          wallet: targetWallet,
          role,
          assigned: false,
          message: "Role already assigned",
        };
      }

      await prismaClient.roleAssignment.create({
        data: {
          memberId: member.id,
          role: role as Role,
          source: "manual",
          active: true,
        },
      });

      await bumpRoleVersion(communityId);

      return { communityId, wallet: targetWallet, role, assigned: true };
    },

    async removeMemberRole(input: {
      requesterWallet: string;
      communityId: string;
      targetWallet: string;
      role: string;
    }) {
      const { requesterWallet, communityId, targetWallet, role } = input;
      await ensureAdmin(requesterWallet, communityId);

      const targetW = await prismaClient.wallet.findUnique({
        where: { address: normaliseWallet(targetWallet) },
      });
      if (!targetW) throw new MemberServiceError("Target wallet not found", 404);

      const member = await prismaClient.member.findUnique({
        where: {
          communityId_walletId: { communityId, walletId: targetW.id },
        },
      });
      if (!member) throw new MemberServiceError("Member not found", 404);

      const result = await prismaClient.roleAssignment.updateMany({
        where: { memberId: member.id, role: role as Role, active: true },
        data: { active: false },
      });

      if (result.count > 0) {
        await bumpRoleVersion(communityId);
      }

      return {
        communityId,
        wallet: targetWallet,
        role,
        removed: result.count > 0,
      };
    },

    async createMembership(
      input: CreateMembershipInput,
    ): Promise<MembershipMutationResult> {
      const {
        requesterWallet,
        communityId,
        targetWallet,
        expiresAt,
        displayName,
      } = input;
      await ensureAdmin(requesterWallet, communityId);

      const walletAddress = normaliseWallet(targetWallet);

      return await prismaClient.$transaction(async (tx: any) => {
        const wallet = await tx.wallet.upsert({
          where: { address: walletAddress },
          update: {},
          create: { address: walletAddress },
        });

        let profileId: string | undefined;
        if (displayName) {
          const profile = await tx.profile.create({
            data: { displayName },
          });
          profileId = profile.id;
        }

        const member = await tx.member.upsert({
          where: { communityId_walletId: { communityId, walletId: wallet.id } },
          update: profileId ? { profileId } : {},
          create: { communityId, walletId: wallet.id, profileId },
        });

        const existingMembership = await tx.membership.findUnique({
          where: { memberId: member.id },
        });

        if (existingMembership) {
          throw new MemberServiceError("Membership already exists", 409);
        }

        const expiryDate = expiresAt ? new Date(expiresAt) : null;
        const membership = await tx.membership.create({
          data: {
            memberId: member.id,
            state: "active",
            expiresAt: expiryDate,
          },
        });

        await logEventTx(tx as any, {
          eventType: "MEMBERSHIP_CREATED",
          walletId: walletAddress,
          communityId,
          afterState: membership,
        });

        await bumpMembershipVersion(communityId);

        return {
          communityId,
          wallet: walletAddress as any,
          state: membership.state as any,
          expiresAt: membership.expiresAt?.toISOString() ?? null,
        };
      });
    },

    async renewMembership(
      input: RenewMembershipInput,
    ): Promise<MembershipMutationResult> {
      const { requesterWallet, communityId, targetWallet, expiresAt } = input;
      await ensureAdmin(requesterWallet, communityId);

      const walletAddress = normaliseWallet(targetWallet);

      return await prismaClient.$transaction(async (tx: any) => {
        const wallet = await tx.wallet.findUnique({
          where: { address: walletAddress },
        });
        if (!wallet) throw new MemberServiceError("Wallet not found", 404);

        const member = await tx.member.findUnique({
          where: { communityId_walletId: { communityId, walletId: wallet.id } },
        });
        if (!member) throw new MemberServiceError("Member not found", 404);

        const existing = await tx.membership.findUnique({
          where: { memberId: member.id },
        });
        if (!existing)
          throw new MemberServiceError("Membership not found", 404);

        const newExpiry = new Date(expiresAt);
        const updated = await tx.membership.update({
          where: { id: existing.id },
          data: {
            expiresAt: newExpiry,
            renewedAt: new Date(),
            state: "active", // Reactivate if it was expired/suspended? Let's say yes for renewal.
          },
        });

        await logEventTx(tx as any, {
          eventType: "MEMBERSHIP_UPDATED",
          walletId: walletAddress,
          communityId,
          beforeState: existing,
          afterState: updated,
        });

        await bumpMembershipVersion(communityId);

        return {
          communityId,
          wallet: walletAddress as any,
          state: updated.state as any,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
        };
      });
    },

    async suspendMembership(
      input: UpdateMembershipStatusInput,
    ): Promise<MembershipMutationResult> {
      const { requesterWallet, communityId, targetWallet } = input;
      await ensureAdmin(requesterWallet, communityId);

      const walletAddress = normaliseWallet(targetWallet);

      return await prismaClient.$transaction(async (tx: any) => {
        const wallet = await tx.wallet.findUnique({
          where: { address: walletAddress },
        });
        if (!wallet) throw new MemberServiceError("Wallet not found", 404);

        const member = await tx.member.findUnique({
          where: { communityId_walletId: { communityId, walletId: wallet.id } },
        });
        if (!member) throw new MemberServiceError("Member not found", 404);

        const existing = await tx.membership.findUnique({
          where: { memberId: member.id },
        });
        if (!existing)
          throw new MemberServiceError("Membership not found", 404);

        const updated = await tx.membership.update({
          where: { id: existing.id },
          data: { state: "suspended" },
        });

        await logEventTx(tx as any, {
          eventType: "MEMBERSHIP_UPDATED",
          walletId: walletAddress,
          communityId,
          beforeState: existing,
          afterState: updated,
        });

        await bumpMembershipVersion(communityId);

        return {
          communityId,
          wallet: walletAddress as any,
          state: updated.state as any,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
        };
      });
    },

    async reactivateMembership(
      input: UpdateMembershipStatusInput,
    ): Promise<MembershipMutationResult> {
      const { requesterWallet, communityId, targetWallet } = input;
      await ensureAdmin(requesterWallet, communityId);

      const walletAddress = normaliseWallet(targetWallet);

      return await prismaClient.$transaction(async (tx: any) => {
        const wallet = await tx.wallet.findUnique({
          where: { address: walletAddress },
        });
        if (!wallet) throw new MemberServiceError("Wallet not found", 404);

        const member = await tx.member.findUnique({
          where: { communityId_walletId: { communityId, walletId: wallet.id } },
        });
        if (!member) throw new MemberServiceError("Member not found", 404);

        const existing = await tx.membership.findUnique({
          where: { memberId: member.id },
        });
        if (!existing)
          throw new MemberServiceError("Membership not found", 404);

        if (existing.state !== "suspended") {
          throw new MemberServiceError("Membership is not suspended", 400);
        }

        const updated = await tx.membership.update({
          where: { id: existing.id },
          data: { state: "active" },
        });

        await logEventTx(tx as any, {
          eventType: "MEMBERSHIP_UPDATED",
          walletId: walletAddress,
          communityId,
          beforeState: existing,
          afterState: updated,
        });

        await bumpMembershipVersion(communityId);

        return {
          communityId,
          wallet: walletAddress as any,
          state: updated.state as any,
          expiresAt: updated.expiresAt?.toISOString() ?? null,
        };
      });
    },

    // Invalidation hooks
    bumpMembershipVersion,
    bumpRoleVersion,
    bumpPolicyVersion,
    bumpResourceVersion,
  };
}

export const memberService = getMemberService(prisma);

// Backwards-compatible re-export of the invalidation hooks.
export const bumpMembershipVersion = memberService.bumpMembershipVersion;
export const bumpRoleVersion = memberService.bumpRoleVersion;
export const bumpPolicyVersion = memberService.bumpPolicyVersion;
export const bumpResourceVersion = memberService.bumpResourceVersion;
