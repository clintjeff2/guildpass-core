import type { MembershipState } from '@guildpass/shared-types';
import { PrismaClient } from '@prisma/client';
import { getMemberService } from './memberService';

// Mock Prisma client
const mockPrisma = {
  wallet: {
    findUnique: jest.fn(),
  },
  member: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  accessPolicy: {
    findFirst: jest.fn(),
  },
  community: {
    findUnique: jest.fn(),
  },
  roleAssignment: {
    findFirst: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  },
} as unknown as PrismaClient;

describe('getMemberService - Membership State Normalization', () => {
  let memberService: ReturnType<typeof getMemberService>;

  beforeEach(() => {
    jest.clearAllMocks();
    memberService = getMemberService(mockPrisma);
  });

  describe('getNormalizedMembershipState - helper function behavior', () => {
    // These tests verify the normalization logic indirectly through service methods
    // since the helper is not exported. The actual helper is tested through integration tests.

    test('should treat active membership as active when no expiry', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: null,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('active');
    });

    test('should treat active membership as expired when expiresAt is in the past', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000); // 1 day ago
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('expired');
    });

    test('should treat active membership as active when expiresAt is in the future', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const futureDate = new Date(Date.now() + 86400000); // 1 day from now
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: futureDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('active');
    });

    test('should return invited state when no membership', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const mockMember = {
        communityId: 'community-1',
        membership: null,
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('invited');
    });

    test('should preserve suspended state when not expired', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const futureDate = new Date(Date.now() + 86400000);
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'suspended' as MembershipState,
          expiresAt: futureDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('suspended');
    });

    test('should treat suspended membership as expired when expiresAt is in the past', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'suspended' as MembershipState,
          expiresAt: pastDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('expired');
    });
  });

  describe('getMembershipsByWallet', () => {
    test('should return empty communities for unknown wallet', async () => {
      const wallet = '0x1234567890abcdef';

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.wallet).toBe(wallet);
      expect(result.communities).toEqual([]);
    });

    test('should return multiple communities with normalized states', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMembers = [
        {
          communityId: 'community-1',
          membership: {
            state: 'active' as MembershipState,
            expiresAt: null,
          },
        },
        {
          communityId: 'community-2',
          membership: {
            state: 'active' as MembershipState,
            expiresAt: pastDate,
          },
        },
      ];

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue(mockMembers);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities).toHaveLength(2);
      expect(result.communities[0].state).toBe('active');
      expect(result.communities[1].state).toBe('expired');
    });

    test('should include expiresAt in response', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const expiryDate = new Date('2025-12-31T23:59:59Z');
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: expiryDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].expiresAt).toBe(expiryDate.toISOString());
    });
  });

  describe('getProfileByWallet', () => {
    test('should return null for unknown wallet', async () => {
      const wallet = '0x1234567890abcdef';

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await memberService.getProfileByWallet(wallet, 'community-1');

      expect(result).toBeNull();
    });

    test('should return null when no member found', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await memberService.getProfileByWallet(wallet, 'community-1');

      expect(result).toBeNull();
    });

    test('should return profile with normalized membership state', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMember = {
        communityId: 'community-1',
        profile: {
          id: 'profile-1',
          displayName: 'John Doe',
          bio: 'A member',
        },
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate,
        },
        roles: [],
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);

      const result = await memberService.getProfileByWallet(wallet, 'community-1');

      expect(result).not.toBeNull();
      expect(result!.membership.state).toBe('expired');
      expect(result!.profile.displayName).toBe('John Doe');
    });

    test('should filter active roles', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const mockMember = {
        communityId: 'community-1',
        profile: {
          id: 'profile-1',
          displayName: 'Jane Doe',
          bio: null,
        },
        membership: {
          state: 'active' as MembershipState,
          expiresAt: null,
        },
        roles: [
          { role: 'admin', source: 'manual', active: true },
          { role: 'contributor', source: 'auto', active: false },
        ],
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);

      const result = await memberService.getProfileByWallet(wallet, 'community-1');

      expect(result!.roles).toEqual(['admin']);
    });
  });

  describe('checkAccess', () => {
    test('should deny when wallet not found', async () => {
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe('DENY');
      expect(result.membershipState).toBe('invited');
    });

    test('should deny when member not found', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      expect(result.allowed).toBe(false);
      expect(result.code).toBe('DENY');
    });

    test('should use normalized membership state for MEMBERS_ONLY policy', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMember = {
        roles: [],
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate, // Expired even though state is 'active'
        },
      };
      const mockPolicy = {
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'MEMBERS_ONLY',
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValue(mockPolicy);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      // Should be denied because membership is expired (even though stored state is 'active')
      expect(result.allowed).toBe(false);
      expect(result.membershipState).toBe('expired');
    });

    test('should allow access for PUBLIC policy even with expired membership', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMember = {
        roles: [],
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate,
        },
      };
      const mockPolicy = {
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'PUBLIC',
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValue(mockPolicy);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      // PUBLIC policy allows access regardless of membership state
      expect(result.allowed).toBe(true);
      expect(result.membershipState).toBe('expired');
    });

    test('should allow access for MEMBERS_ONLY with active membership and future expiry', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };
      const futureDate = new Date(Date.now() + 86400000);
      const mockMember = {
        roles: [],
        membership: {
          state: 'active' as MembershipState,
          expiresAt: futureDate,
        },
      };
      const mockPolicy = {
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'MEMBERS_ONLY',
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValue(mockPolicy);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      expect(result.allowed).toBe(true);
      expect(result.membershipState).toBe('active');
    });

    test('should handle case-insensitive wallet address', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };
      const mockMember = {
        roles: [],
        membership: {
          state: 'active' as MembershipState,
          expiresAt: null,
        },
      };
      const mockPolicy = {
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'MEMBERS_ONLY',
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValue(mockPolicy);

      await memberService.checkAccess({
        wallet: '0x1234567890ABCDEF',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      expect(mockPrisma.wallet.findUnique).toHaveBeenCalledWith({
        where: { address: '0x1234567890abcdef' },
      });
    });
  });

  describe('listMembersForAdmin', () => {
    test('should return members with normalized state', async () => {

      const pastDate = new Date(Date.now() - 86400000);
      const futureDate = new Date(Date.now() + 86400000);
      const mockMembers = [
        {
          wallet: { address: '0x1111111111111111' },
          profile: { displayName: 'Member 1' },
          membership: {
            state: 'active' as MembershipState,
            expiresAt: pastDate, // expired
          },
          roles: [{ role: 'member', source: 'auto', active: true }],
        },
        {
          wallet: { address: '0x2222222222222222' },
          profile: { displayName: 'Member 2' },
          membership: {
            state: 'active' as MembershipState,
            expiresAt: futureDate, // still valid
          },
          roles: [{ role: 'admin', source: 'manual', active: true }],
        },
      ];

      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue(mockMembers);

      const result = await memberService.listMembersForAdmin('community-1');

      expect(result.members).toHaveLength(2);
      expect(result.members[0].state).toBe('expired');
      expect(result.members[1].state).toBe('active');
    });

    test('should filter members by role', async () => {
      const mockMembers = [
        {
          wallet: { address: '0x1111111111111111' },
          profile: { displayName: 'Admin' },
          membership: {
            state: 'active' as MembershipState,
            expiresAt: null,
          },
          roles: [{ role: 'admin', source: 'manual', active: true }],
        },
        {
          wallet: { address: '0x2222222222222222' },
          profile: { displayName: 'Member' },
          membership: {
            state: 'active' as MembershipState,
            expiresAt: null,
          },
          roles: [{ role: 'member', source: 'auto', active: true }],
        },
      ];

      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue(mockMembers);

      const result = await memberService.listMembersForAdmin('community-1', 'admin');

      expect(result.members).toHaveLength(1);
      expect(result.members[0].wallet).toBe('0x1111111111111111');
    });

    test('should only include active roles', async () => {
      const mockMembers = [
        {
          wallet: { address: '0x1111111111111111' },
          profile: { displayName: 'User' },
          membership: {
            state: 'active' as MembershipState,
            expiresAt: null,
          },
          roles: [
            { role: 'admin', source: 'manual', active: true },
            { role: 'contributor', source: 'auto', active: false },
          ],
        },
      ];

      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue(mockMembers);

      const result = await memberService.listMembersForAdmin('community-1');

      expect(result.members[0].roles).toEqual(['admin']);
    });
  });

  describe('assignMemberRole', () => {
    test('should assign a role when the requester is an admin', async () => {
      const requesterWallet = '0x1111111111111111111111111111111111111111';
      const targetWallet = '0x2222222222222222222222222222222222222222';

      (mockPrisma.community.findUnique as jest.Mock).mockResolvedValue({ id: 'community-1' });
      (mockPrisma.wallet.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'wallet-req', address: requesterWallet.toLowerCase() })
        .mockResolvedValueOnce({ id: 'wallet-target', address: targetWallet.toLowerCase() });
      (mockPrisma.member.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'member-req', roles: [{ role: 'admin', active: true }] })
        .mockResolvedValueOnce({ id: 'member-target' });
      (mockPrisma.roleAssignment.findFirst as jest.Mock).mockResolvedValue(null);
      (mockPrisma.roleAssignment.create as jest.Mock).mockResolvedValue({ id: 'assignment-1' });

      const result = await memberService.assignMemberRole({
        requesterWallet,
        communityId: 'community-1',
        targetWallet,
        role: 'admin',
      });

      expect(result.assigned).toBe(true);
      expect(mockPrisma.roleAssignment.create).toHaveBeenCalled();
    });

    test('should not create a duplicate role assignment', async () => {
      const requesterWallet = '0x1111111111111111111111111111111111111111';
      const targetWallet = '0x2222222222222222222222222222222222222222';

      (mockPrisma.community.findUnique as jest.Mock).mockResolvedValue({ id: 'community-1' });
      (mockPrisma.wallet.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'wallet-req', address: requesterWallet.toLowerCase() })
        .mockResolvedValueOnce({ id: 'wallet-target', address: targetWallet.toLowerCase() });
      (mockPrisma.member.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'member-req', roles: [{ role: 'admin', active: true }] })
        .mockResolvedValueOnce({ id: 'member-target' });
      (mockPrisma.roleAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });

      const result = await memberService.assignMemberRole({
        requesterWallet,
        communityId: 'community-1',
        targetWallet,
        role: 'admin',
      });

      expect(result.assigned).toBe(false);
      expect(mockPrisma.roleAssignment.create).not.toHaveBeenCalled();
    });

    test('should reject non-admin requesters with 403', async () => {
      const requesterWallet = '0x1111111111111111111111111111111111111111';
      const targetWallet = '0x2222222222222222222222222222222222222222';

      (mockPrisma.community.findUnique as jest.Mock).mockResolvedValue({ id: 'community-1' });
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce({
        id: 'wallet-req',
        address: requesterWallet.toLowerCase(),
      });
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'member-req',
        roles: [{ role: 'member', active: true }],
      });

      await expect(
        memberService.assignMemberRole({
          requesterWallet,
          communityId: 'community-1',
          targetWallet,
          role: 'admin',
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    test('should reject invalid role values', async () => {
      await expect(
        memberService.assignMemberRole({
          requesterWallet: '0x1111111111111111111111111111111111111111',
          communityId: 'community-1',
          targetWallet: '0x2222222222222222222222222222222222222222',
          role: 'owner',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('removeMemberRole', () => {
    test('should deactivate an existing role assignment', async () => {
      const requesterWallet = '0x1111111111111111111111111111111111111111';
      const targetWallet = '0x2222222222222222222222222222222222222222';

      (mockPrisma.community.findUnique as jest.Mock).mockResolvedValue({ id: 'community-1' });
      (mockPrisma.wallet.findUnique as jest.Mock)
        .mockResolvedValueOnce({ id: 'wallet-req', address: requesterWallet.toLowerCase() })
        .mockResolvedValueOnce({ id: 'wallet-target', address: targetWallet.toLowerCase() });
      (mockPrisma.member.findFirst as jest.Mock)
        .mockResolvedValueOnce({ id: 'member-req', roles: [{ role: 'admin', active: true }] })
        .mockResolvedValueOnce({ id: 'member-target' });
      (mockPrisma.roleAssignment.findFirst as jest.Mock).mockResolvedValue({ id: 'existing' });
      (mockPrisma.roleAssignment.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      const result = await memberService.removeMemberRole({
        requesterWallet,
        communityId: 'community-1',
        targetWallet,
        role: 'admin',
      });

      expect(result.removed).toBe(true);
      expect(mockPrisma.roleAssignment.updateMany).toHaveBeenCalled();
    });
  });

  describe('Acceptance Criteria - Comprehensive Coverage', () => {
    test('should treat expired membership different from stored state', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000);
      
      // Membership marked as 'active' but expired
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('expired');
      expect(result.communities[0].expiresAt).toBe(pastDate.toISOString());
    });

    test('should continue using stored state when no expiresAt', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      
      // Membership with no expiry
      const mockMember = {
        communityId: 'community-1',
        membership: {
          state: 'active' as MembershipState,
          expiresAt: null,
        },
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValue([mockMember]);

      const result = await memberService.getMembershipsByWallet(wallet, 'community-1');

      expect(result.communities[0].state).toBe('active');
    });

    test('should allow PUBLIC access regardless of membership state', async () => {
      const mockWallet = { id: 'wallet-1', address: '0x1234567890abcdef' };
      const pastDate = new Date(Date.now() - 86400000);
      const mockMember = {
        roles: [],
        membership: {
          state: 'active' as MembershipState,
          expiresAt: pastDate,
        },
      };
      const mockPolicy = {
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'PUBLIC',
      };

      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue(mockMember);
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValue(mockPolicy);

      const result = await memberService.checkAccess({
        wallet: '0x1234567890abcdef',
        communityId: 'community-1',
        resource: 'resource-1',
      });

      expect(result.allowed).toBe(true);
    });

    test('should return consistent effective state across methods', async () => {
      const wallet = '0x1234567890abcdef';
      const mockWallet = { id: 'wallet-1', address: wallet.toLowerCase() };
      const pastDate = new Date(Date.now() - 86400000);

      const memberData = {
        state: 'active' as MembershipState,
        expiresAt: pastDate,
      };

      // Test getMembershipsByWallet
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce(mockWallet);
      (mockPrisma.member.findMany as jest.Mock).mockResolvedValueOnce([
        {
          communityId: 'community-1',
          membership: memberData,
        },
      ]);

      const result1 = await memberService.getMembershipsByWallet(wallet, 'community-1');

      // Test getProfileByWallet
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValueOnce({
        communityId: 'community-1',
        profile: {
          id: 'profile-1',
          displayName: 'User',
          bio: null,
        },
        membership: memberData,
        roles: [],
      });

      const result2 = await memberService.getProfileByWallet(wallet, 'community-1');

      // Test checkAccess
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce(mockWallet);
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValueOnce({
        roles: [],
        membership: memberData,
      });
      (mockPrisma.accessPolicy.findFirst as jest.Mock).mockResolvedValueOnce({
        id: 'policy-1',
        communityId: 'community-1',
        resource: 'resource-1',
        rule: 'MEMBERS_ONLY',
      });

      const result3 = await memberService.checkAccess({
        wallet,
        communityId: 'community-1',
        resource: 'resource-1',
      });

      // All should report 'expired' state
      expect(result1.communities[0].state).toBe('expired');
      expect(result2!.membership.state).toBe('expired');
      expect(result3.membershipState).toBe('expired');
    });
  });

  describe('Membership Lifecycle Mutations', () => {
    const requesterWallet = '0x1111111111111111111111111111111111111111' as any;
    const targetWallet = '0x2222222222222222222222222222222222222222' as any;
    const communityId = 'community-1';

    beforeEach(() => {
      // Mock ensureAdmin success by default
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValue({ id: 'w-admin' });
      (mockPrisma.member.findFirst as jest.Mock).mockResolvedValue({
        roles: [{ role: 'admin', active: true }],
      });
      (mockPrisma.$transaction as jest.Mock) = jest.fn((cb) => cb(mockPrisma));
    });

    test('createMembership should create all records', async () => {
      (mockPrisma.wallet.upsert as jest.Mock).mockResolvedValue({ id: 'w-target' });
      (mockPrisma.member.upsert as jest.Mock).mockResolvedValue({ id: 'm-target' });
      (mockPrisma.membership.findUnique as jest.Mock).mockResolvedValue(null);
      (mockPrisma.membership.create as jest.Mock).mockResolvedValue({
        state: 'active',
        expiresAt: null,
      });
      (mockPrisma.auditEvent.create as jest.Mock).mockResolvedValue({});

      const result = await memberService.createMembership({
        requesterWallet,
        communityId,
        targetWallet,
      });

      expect(result.state).toBe('active');
      expect(mockPrisma.membership.create).toHaveBeenCalled();
    });

    test('renewMembership should update expiresAt', async () => {
      const futureDate = new Date(Date.now() + 1000000).toISOString();
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'w-admin' }) // ensureAdmin
                                                 .mockResolvedValueOnce({ id: 'w-target' }); // renew
      (mockPrisma.member.findUnique as jest.Mock).mockResolvedValue({ id: 'm-target' });
      (mockPrisma.membership.findUnique as jest.Mock).mockResolvedValue({ id: 'ms-target', state: 'active' });
      (mockPrisma.membership.update as jest.Mock).mockResolvedValue({
        state: 'active',
        expiresAt: new Date(futureDate),
      });

      const result = await memberService.renewMembership({
        requesterWallet,
        communityId,
        targetWallet,
        expiresAt: futureDate,
      });

      expect(result.expiresAt).toBe(new Date(futureDate).toISOString());
      expect(mockPrisma.membership.update).toHaveBeenCalled();
    });

    test('suspendMembership should update state', async () => {
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'w-admin' })
                                                 .mockResolvedValueOnce({ id: 'w-target' });
      (mockPrisma.member.findUnique as jest.Mock).mockResolvedValue({ id: 'm-target' });
      (mockPrisma.membership.findUnique as jest.Mock).mockResolvedValue({ id: 'ms-target', state: 'active' });
      (mockPrisma.membership.update as jest.Mock).mockResolvedValue({
        state: 'suspended',
        expiresAt: null,
      });

      const result = await memberService.suspendMembership({
        requesterWallet,
        communityId,
        targetWallet,
      });

      expect(result.state).toBe('suspended');
    });

    test('reactivateMembership should restore state', async () => {
      (mockPrisma.wallet.findUnique as jest.Mock).mockResolvedValueOnce({ id: 'w-admin' })
                                                 .mockResolvedValueOnce({ id: 'w-target' });
      (mockPrisma.member.findUnique as jest.Mock).mockResolvedValue({ id: 'm-target' });
      (mockPrisma.membership.findUnique as jest.Mock).mockResolvedValue({ id: 'ms-target', state: 'suspended' });
      (mockPrisma.membership.update as jest.Mock).mockResolvedValue({
        state: 'active',
        expiresAt: null,
      });

      const result = await memberService.reactivateMembership({
        requesterWallet,
        communityId,
        targetWallet,
      });

      expect(result.state).toBe('active');
    });
  });
});
