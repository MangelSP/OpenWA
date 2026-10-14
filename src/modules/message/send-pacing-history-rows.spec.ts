import { DataSource } from 'typeorm';
import { SendPacingService } from './send-pacing.service';
import { Message, MessageDirection } from './entities/message.entity';
import { Session } from '../session/entities/session.entity';
import { computeSendPacingConfig } from './send-pacing.config';
import type { ConfigService } from '@nestjs/config';

/**
 * The history backfill stores the messages the linked phone sent BEFORE the number was connected, each
 * stamped with WhatsApp's own time (message-history-projector.ts). Any of them sent earlier today lands
 * inside today's window, and used to spend the daily allowance of a session that had sent nothing —
 * "Daily send allowance of 20 reached, sentToday: 83" on a number linked minutes earlier.
 *
 * Driven against a real SQLite schema, like the cold-reachout spec: the discriminator is part of a
 * hand-written query, which a mocked repository cannot prove.
 */
describe('send pacing and backfilled history rows', () => {
  let ds: DataSource;

  const DAY_MS = 86_400_000;
  const NOW = new Date('2026-08-03T12:00:00.000Z');
  const TODAY = '2026-08-03T09:00:00.000Z';
  const YESTERDAY = '2026-08-02T09:00:00.000Z';

  const serviceWith = (over: Record<string, unknown>): SendPacingService => {
    const config = {
      get: (key: string) =>
        key === 'sendPacing' ? { ...computeSendPacingConfig({}), enabled: true, ...over } : undefined,
    } as unknown as ConfigService;
    return new SendPacingService(ds.getRepository(Message), ds.getRepository(Session), config);
  };

  /** A row as the gateway writes it (a send or a live echo), or as the history backfill writes it. */
  const addMessage = (
    chatId: string,
    at: string,
    { direction = MessageDirection.OUTGOING, history = false } = {},
  ): Promise<unknown> =>
    ds.query(
      `INSERT INTO "messages" ("id","sessionId","chatId","from","to","type","direction","createdAt","historySynced")
       VALUES (?,?,?,'a','b','text',?,?,?)`,
      [`${chatId}-${at}-${direction}-${history}`, 's1', chatId, direction, at, history ? 1 : null],
    );

  beforeEach(async () => {
    jest.useFakeTimers().setSystemTime(NOW);
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Message, Session],
      synchronize: true,
    });
    await ds.initialize();
    await ds.getRepository(Session).save({ name: 'bot', id: 's1', createdAt: new Date(NOW.getTime() - 0 * DAY_MS) });
  });

  afterEach(async () => {
    jest.useRealTimers();
    await ds.destroy();
  });

  describe('the daily allowance', () => {
    const service = (): SendPacingService => serviceWith({ warmupSchedule: [2], coldSchedule: [] });

    it('does not spend on messages the phone sent earlier today, however many there are', async () => {
      for (let i = 0; i < 83; i++) await addMessage(`phone-${i}@c.us`, TODAY, { history: true });

      await expect(service().assertSendAllowed('s1')).resolves.toBeUndefined();
    });

    it("spends on the gateway's own sends today", async () => {
      await addMessage('a@c.us', TODAY);
      await addMessage('b@c.us', TODAY);

      await expect(service().assertSendAllowed('s1')).rejects.toMatchObject({ status: 429 });
    });

    it('counts only the gateway rows when both kinds are present', async () => {
      for (let i = 0; i < 10; i++) await addMessage(`phone-${i}@c.us`, TODAY, { history: true });
      await addMessage('a@c.us', TODAY);
      const pacing = service();

      // One of two used.
      await expect(pacing.assertSendAllowed('s1')).resolves.toBeUndefined();

      await addMessage('b@c.us', TODAY);
      await expect(pacing.assertSendAllowed('s1')).rejects.toMatchObject({ status: 429 });
    });

    it('still counts a live echo of a phone-composed send (only the backfill is exempt)', async () => {
      await addMessage('a@c.us', TODAY); // the own-send echo writes a row with no history flag
      await addMessage('b@c.us', TODAY);

      await expect(service().assertSendAllowed('s1')).rejects.toMatchObject({ status: 429 });
    });

    it('ignores backfilled incoming rows as before', async () => {
      await addMessage('a@c.us', TODAY, { direction: MessageDirection.INCOMING, history: true });
      await addMessage('b@c.us', TODAY, { direction: MessageDirection.INCOMING });

      await expect(service().assertSendAllowed('s1')).resolves.toBeUndefined();
    });
  });

  describe('the cold-reachout allowance', () => {
    const service = (): SendPacingService => serviceWith({ warmupSchedule: [10_000], coldSchedule: [1] });

    it("does not count chats the phone started today as the gateway's reachouts", async () => {
      await addMessage('phone-1@c.us', TODAY, { history: true });
      await addMessage('phone-2@c.us', TODAY, { history: true });
      await addMessage('phone-3@c.us', TODAY, { history: true });

      // The allowance of one is untouched, so a stranger can still be approached.
      await expect(service().assertSendAllowed('s1', 'stranger@c.us')).resolves.toBeInstanceOf(Function);
    });

    it('counts a chat the gateway started today', async () => {
      await addMessage('phone-1@c.us', TODAY, { history: true });
      await addMessage('gateway-1@c.us', TODAY);

      await expect(service().assertSendAllowed('s1', 'stranger@c.us')).rejects.toMatchObject({ status: 429 });
    });

    // The exemption is for the count, not for the idea of history: a chat the phone already wrote to is
    // known to the account, so a send into it is a reply, not a reachout, even with the allowance spent.
    it('still reads backfilled rows as chat history when deciding who is a stranger', async () => {
      await addMessage('gateway-1@c.us', TODAY); // spends the one reachout
      await addMessage('phone-today@c.us', TODAY, { history: true });
      await addMessage('phone-old@c.us', YESTERDAY, { history: true });
      const pacing = service();

      await expect(pacing.assertSendAllowed('s1', 'phone-today@c.us')).resolves.toBeInstanceOf(Function);
      await expect(pacing.assertSendAllowed('s1', 'phone-old@c.us')).resolves.toBeInstanceOf(Function);
      await expect(pacing.assertSendAllowed('s1', 'stranger@c.us')).rejects.toMatchObject({ status: 429 });
    });

    it('still treats a backfilled earlier-today message as history for a chat the gateway then writes to', async () => {
      // The phone texted at 01:00 and they answered at 02:00; the gateway's 10:00 reply continues an
      // answered conversation. Only the gateway's own first send is the yardstick for "they wrote first".
      await addMessage('talk@c.us', '2026-08-03T01:00:00.000Z', { history: true });
      await addMessage('talk@c.us', '2026-08-03T02:00:00.000Z', {
        direction: MessageDirection.INCOMING,
        history: true,
      });
      await addMessage('talk@c.us', '2026-08-03T10:00:00.000Z');

      await expect(service().assertSendAllowed('s1', 'stranger@c.us')).resolves.toBeInstanceOf(Function);
    });

    it('counts group adds against a day the phone filled with its own chats just the same', async () => {
      await addMessage('phone-1@c.us', TODAY, { history: true });
      await addMessage('phone-2@c.us', TODAY, { history: true });

      await expect(service().assertReachoutAllowed('s1', ['a@c.us'])).resolves.toMatchObject({ coldCount: 1 });
    });
  });
});
