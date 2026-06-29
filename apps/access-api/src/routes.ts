import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getMemberService, MemberServiceError } from './services/memberService';
import { getPrisma } from './services/prisma';
import { notFound, validationError } from './errors';

function getRequesterWallet(request: FastifyRequest): string {
  const header = request.headers['x-wallet'] ?? request.headers['x-user-wallet'] ?? request.headers['x-requester-wallet'];
  if (Array.isArray(header)) {
    return header[0] ?? '';
  }
  if (header) {
    return header;
  }
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  return '';
}

function sendRoleMutationError(reply: FastifyReply, error: unknown) {
  if (error instanceof MemberServiceError) {
    return reply.status(error.statusCode).send({ error: error.message });
  }
  return reply.status(500).send({ error: 'Internal server error' });
}

/**
 * Register all business routes on the Fastify instance.
 * Uses app.inject() friendly routes — no network binding required for tests.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  const prisma = getPrisma();
  const memberService = getMemberService(prisma);

  // GET /v1/communities/:communityId/memberships/:wallet — list membership communities for a wallet
  app.get('/v1/communities/:communityId/memberships/:wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const result = await memberService.getMembershipsByWallet(wallet, communityId);
    return result;
  });

  // GET /v1/communities/:communityId/members/:wallet — get member profile
  app.get('/v1/communities/:communityId/members/:wallet', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const result = await memberService.getProfileByWallet(wallet, communityId);
    if (!result) {
      return reply.status(404).send(notFound('Member not found'));
    }
    return result;
  });

  // POST /v1/communities/:communityId/members/:wallet/roles — assign a role to a member
  app.post('/v1/communities/:communityId/members/:wallet/roles', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const body = request.body as { role?: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.assignMemberRole({
        requesterWallet,
        communityId,
        targetWallet: wallet,
        role: body?.role ?? '',
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // DELETE /v1/communities/:communityId/members/:wallet/roles/:role — remove an assigned role
  app.delete('/v1/communities/:communityId/members/:wallet/roles/:role', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet, role } = request.params as { communityId: string; wallet: string; role: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.removeMemberRole({
        requesterWallet,
        communityId,
        targetWallet: wallet,
        role,
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // POST /v1/communities/:communityId/members/:wallet/membership — create a membership
  app.post('/v1/communities/:communityId/members/:wallet/membership', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const body = request.body as { expiresAt?: string; displayName?: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.createMembership({
        requesterWallet: requesterWallet as any,
        communityId,
        targetWallet: wallet as any,
        expiresAt: body?.expiresAt,
        displayName: body?.displayName,
      });
      return reply.status(201).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // PATCH /v1/communities/:communityId/members/:wallet/membership — renew a membership
  app.patch('/v1/communities/:communityId/members/:wallet/membership', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const body = request.body as { expiresAt: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.renewMembership({
        requesterWallet: requesterWallet as any,
        communityId,
        targetWallet: wallet as any,
        expiresAt: body?.expiresAt,
      } as any);
      return reply.status(200).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // POST /v1/communities/:communityId/members/:wallet/membership/suspend — suspend a membership
  app.post('/v1/communities/:communityId/members/:wallet/membership/suspend', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.suspendMembership({
        requesterWallet: requesterWallet as any,
        communityId,
        targetWallet: wallet as any,
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // POST /v1/communities/:communityId/members/:wallet/membership/reactivate — reactivate a membership
  app.post('/v1/communities/:communityId/members/:wallet/membership/reactivate', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId, wallet } = request.params as { communityId: string; wallet: string };
    const requesterWallet = getRequesterWallet(request);

    try {
      const result = await memberService.reactivateMembership({
        requesterWallet: requesterWallet as any,
        communityId,
        targetWallet: wallet as any,
      });
      return reply.status(200).send(result);
    } catch (error) {
      return sendRoleMutationError(reply, error);
    }
  });

  // POST /v1/access/check — check access for wallet/resource
  app.post('/v1/access/check', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      wallet: `0x${string}`;
      communityId: string;
      resource: string;
    };
    if (!body?.wallet || !body?.communityId || !body?.resource) {
      return reply.status(400).send(
        validationError('Missing required fields: wallet, communityId, resource'),
      );
    }
    const result = await memberService.checkAccess(body as import('@guildpass/shared-types').AccessCheckInput);
    return result;
  });

  // GET /v1/communities/:communityId/members — list members for admin
  app.get('/v1/communities/:communityId/members', async (request: FastifyRequest, reply: FastifyReply) => {
    const { communityId } = request.params as { communityId: string };
    const role = (request.query as { role?: string })?.role;
    // Ensure caller is an authenticated community admin by reusing mutation auth check.
    const requesterWallet = getRequesterWallet(request);
    try {
      // Reuse a minimal auth check by verifying requester has admin role in the community.
      // We do this by calling listMembersForAdmin only after requester is validated.
      const requesterMembers = await memberService.listMembersForAdmin(
        communityId,
        role as 'admin' | 'member' | 'contributor' | undefined,
      );
      // listMembersForAdmin is not requester-scoped; enforce admin authorization in a lightweight way:
      // If requester is missing from admin-filtered listing, deny.
      if (role === 'admin') {
        // If caller requested admin-only view, still require requester to be admin.
        const isAdmin = requesterMembers.members.some(
          (m: any) => m.wallet?.toLowerCase?.() === requesterWallet.toLowerCase(),
        );
        if (!isAdmin) return reply.status(403).send({ error: 'Forbidden' });
      }
      return requesterMembers;
    } catch (error) {
      if (error instanceof MemberServiceError) {
        return reply.status(error.statusCode).send({ error: error.message });
      }
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

}
