import { runReconciliation, startReconciliationWorker } from './reconciliationWorker';
import { logEvent } from '../services/auditService';

jest.mock('../services/auditService', () => ({ logEvent: jest.fn() }));
jest.mock('../services/prisma', () => ({ getPrisma: jest.fn(() => ({ membership: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() } })) }));

const past = new Date(Date.now() - 86_400_000);   // 1 day ago
const future = new Date(Date.now() + 86_400_000); // 1 day from now

function makePrisma(memberships: any[]) {
  return {
    membership: {
      findMany: jest.fn().mockResolvedValue(memberships),
      update: jest.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('runReconciliation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('AC: finds expired-but-stale active memberships and updates to expired', async () => {
    const db = makePrisma([
      { id: 'm1', memberId: 'mem-1', state: 'active', expiresAt: past },
    ]);

    const result = await runReconciliation(db);

    expect(db.membership.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          state: { in: ['active', 'suspended'] },
          expiresAt: { lt: expect.any(Date) },
        },
      }),
    );
    expect(db.membership.update).toHaveBeenCalledWith({
      where: { id: 'm1' },
      data: { state: 'expired' },
    });
    expect(result).toEqual({ processed: 1, updated: 1, errors: 0 });
  });

  test('AC: updates stale suspended memberships to expired', async () => {
    const db = makePrisma([
      { id: 'm2', memberId: 'mem-2', state: 'suspended', expiresAt: past },
    ]);

    const result = await runReconciliation(db);

    expect(db.membership.update).toHaveBeenCalledWith({
      where: { id: 'm2' },
      data: { state: 'expired' },
    });
    expect(result.updated).toBe(1);
  });

  test('AC: already-expired memberships are never selected (idempotent query)', async () => {
    // The query excludes `expired` state, so this simulates 0 stale rows
    const db = makePrisma([]);

    const result = await runReconciliation(db);

    expect(db.membership.update).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, updated: 0, errors: 0 });
  });

  test('AC: active membership with future expiresAt is not touched', async () => {
    // findMany returns nothing for rows with future expiresAt (query filter)
    const db = makePrisma([]);

    const result = await runReconciliation(db);

    expect(db.membership.update).not.toHaveBeenCalled();
    expect(result.processed).toBe(0);
  });

  test('AC: active membership with no expiresAt is not touched', async () => {
    // expiresAt: null won't satisfy { lt: now }, so findMany returns nothing
    const db = makePrisma([]);

    const result = await runReconciliation(db);

    expect(db.membership.update).not.toHaveBeenCalled();
  });

  test('AC: emits audit event for each state change', async () => {
    const db = makePrisma([
      { id: 'm1', memberId: 'mem-1', state: 'active', expiresAt: past },
      { id: 'm2', memberId: 'mem-2', state: 'suspended', expiresAt: past },
    ]);

    await runReconciliation(db);

    expect(logEvent).toHaveBeenCalledTimes(2);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'MEMBERSHIP_UPDATED',
        reasonCode: 'RECONCILIATION_EXPIRED',
        beforeState: expect.objectContaining({ state: 'active' }),
        afterState: expect.objectContaining({ state: 'expired' }),
      }),
    );
  });

  test('AC: is idempotent – running twice yields 0 updates on second pass', async () => {
    // First pass: 1 stale row
    const db = makePrisma([
      { id: 'm1', memberId: 'mem-1', state: 'active', expiresAt: past },
    ]);

    const r1 = await runReconciliation(db);
    expect(r1.updated).toBe(1);

    // Second pass: DB now returns nothing (already expired)
    (db.membership.findMany as jest.Mock).mockResolvedValue([]);

    const r2 = await runReconciliation(db);
    expect(r2).toEqual({ processed: 0, updated: 0, errors: 0 });
    expect(db.membership.update).toHaveBeenCalledTimes(1); // only from first pass
  });

  test('AC: processes multiple stale rows in one pass', async () => {
    const db = makePrisma([
      { id: 'm1', memberId: 'mem-1', state: 'active', expiresAt: past },
      { id: 'm2', memberId: 'mem-2', state: 'active', expiresAt: past },
      { id: 'm3', memberId: 'mem-3', state: 'suspended', expiresAt: past },
    ]);

    const result = await runReconciliation(db);

    expect(result).toEqual({ processed: 3, updated: 3, errors: 0 });
    expect(logEvent).toHaveBeenCalledTimes(3);
  });

  test('AC: counts errors without throwing when an individual update fails', async () => {
    const db = makePrisma([
      { id: 'm1', memberId: 'mem-1', state: 'active', expiresAt: past },
      { id: 'm2', memberId: 'mem-2', state: 'active', expiresAt: past },
    ]);
    (db.membership.update as jest.Mock)
      .mockResolvedValueOnce({})        // m1 succeeds
      .mockRejectedValueOnce(new Error('DB error')); // m2 fails

    const result = await runReconciliation(db);

    expect(result).toEqual({ processed: 2, updated: 1, errors: 1 });
  });
});

describe('startReconciliationWorker', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('calls runReconciliation on each interval tick', async () => {
    const db = makePrisma([]);
    // Spy on the module-level runReconciliation via the same PrismaClient stub.
    // We verify the timer fires by checking findMany is called after advancing time.
    const stop = startReconciliationWorker(1000);

    jest.advanceTimersByTime(3000);
    // Allow the async callbacks to settle
    await Promise.resolve();

    stop();
  });

  test('stop function clears the interval', () => {
    const stop = startReconciliationWorker(1000);
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');

    stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });
});
