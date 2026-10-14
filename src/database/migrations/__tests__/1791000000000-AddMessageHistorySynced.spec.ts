import { DataSource } from 'typeorm';
import { AddMessageHistorySynced1791000000000 } from '../1791000000000-AddMessageHistorySynced';

describe('AddMessageHistorySynced migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
    await ds.query(`CREATE TABLE "messages" ("id" varchar PRIMARY KEY NOT NULL, "chatId" varchar NOT NULL)`);
    await ds.query(`INSERT INTO "messages" ("id", "chatId") VALUES ('m1', 'a@c.us')`);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  it('adds a nullable column that reads NULL on existing rows, and drops it again', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessageHistorySynced1791000000000();

    await migration.up(runner);
    expect(await runner.hasColumn('messages', 'historySynced')).toBe(true);
    const rows = (await runner.query(`SELECT "historySynced" FROM "messages"`)) as Array<{ historySynced: unknown }>;
    expect(rows).toEqual([{ historySynced: null }]);

    await migration.down(runner);
    expect(await runner.hasColumn('messages', 'historySynced')).toBe(false);
    await runner.release();
  });

  it('up() and down() are idempotent', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddMessageHistorySynced1791000000000();

    await migration.up(runner);
    await expect(migration.up(runner)).resolves.not.toThrow();
    await migration.down(runner);
    await expect(migration.down(runner)).resolves.not.toThrow();
    await runner.release();
  });
});
