import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `messages.historySynced`: true for a row the pre-connection history backfill wrote, NULL for
 * every other row (so every existing row, which keeps today's behaviour). Send pacing counts today's
 * outgoing rows toward the daily allowance and must not count a message the linked phone sent earlier
 * today, which the backfill stores with its real time.
 *
 * Hand-authored because `synchronize` is off on the `data` connection for Postgres. A nullable column
 * without a default is a catalogue-only change on both dialects: no table rewrite. Idempotent.
 *
 * NOTE: the existence check deliberately avoids `queryRunner.hasColumn('messages', ...)` — since the
 * FTS migration added the STORED generated column `body_ts`, loading that table's metadata on Postgres
 * sends TypeORM looking for `typeorm_metadata`, which nothing in this migration context creates. A raw
 * dialect-aware probe sidesteps it (same reasoning as AddMessageAuthor).
 */
export class AddMessageHistorySynced1791000000000 implements MigrationInterface {
  name = 'AddMessageHistorySynced1791000000000';

  private async hasColumn(queryRunner: QueryRunner): Promise<boolean> {
    if (queryRunner.connection.options.type === 'postgres') {
      const rows = (await queryRunner.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'messages' AND column_name = 'historySynced'`,
      )) as unknown[];
      return rows.length > 0;
    }
    const rows = (await queryRunner.query(`PRAGMA table_info("messages")`)) as Array<{ name: string }>;
    return rows.some(r => r.name === 'historySynced');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await this.hasColumn(queryRunner)) return; // already added by synchronize or a previous run
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN "historySynced" boolean NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await this.hasColumn(queryRunner))) return;
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN "historySynced"`);
  }
}
