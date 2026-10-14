// Wraps renameSync so a test can fail it (the module namespace of 'fs' is not spy-able); every other
// call, and renameSync by default, hits the real filesystem under a tmp dir.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return { ...actual, renameSync: jest.fn(actual.renameSync) };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { computeSendPacingConfig, resolveSendPacingConfig, type SendPacingConfig } from '../message/send-pacing.config';
import {
  clearSendPacingOverride,
  loadSendPacingConfig,
  readSendPacingOverride,
  writeSendPacingOverride,
} from './send-pacing-override';

const FILE = 'send-pacing.json';

describe('send-pacing override persistence', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-pacing-'));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const writeRaw = (contents: string): void => fs.writeFileSync(path.join(dir, FILE), contents);

  it('has no override when the file does not exist, without logging a warning', () => {
    expect(readSendPacingOverride(dir)).toBeUndefined();
    expect(loadSendPacingConfig(dir)).toEqual(computeSendPacingConfig());
  });

  it('round-trips an override through the file', () => {
    writeSendPacingOverride(dir, { enabled: true, warmupSchedule: [30, 60], coldSchedule: [] });

    expect(readSendPacingOverride(dir)).toEqual({ enabled: true, warmupSchedule: [30, 60], coldSchedule: [] });
  });

  it('writes through a tmp file and leaves no temp file behind', () => {
    (fs.renameSync as jest.Mock).mockClear();

    writeSendPacingOverride(dir, { breakerThreshold: 9 });

    expect(fs.renameSync).toHaveBeenCalledTimes(1);
    const [from, to] = (fs.renameSync as jest.Mock).mock.calls[0] as [string, string];
    expect(from).not.toBe(to);
    expect(to).toBe(path.join(dir, FILE));
    expect(fs.readdirSync(dir)).toEqual([FILE]);
  });

  it('keeps the previous file intact and cleans its temp file when the write fails', () => {
    writeSendPacingOverride(dir, { breakerThreshold: 9 });
    (fs.renameSync as jest.Mock).mockImplementationOnce(() => {
      throw new Error('EXDEV');
    });

    expect(() => writeSendPacingOverride(dir, { breakerThreshold: 1 })).toThrow('EXDEV');

    expect(readSendPacingOverride(dir)).toEqual({ breakerThreshold: 9 });
    expect(fs.readdirSync(dir)).toEqual([FILE]);
  });

  it('creates the data dir when it does not exist yet', () => {
    const nested = path.join(dir, 'fresh', 'data');

    writeSendPacingOverride(nested, { enabled: false });

    expect(readSendPacingOverride(nested)).toEqual({ enabled: false });
  });

  it('clears the override, and clearing twice is harmless', () => {
    writeSendPacingOverride(dir, { enabled: true });

    clearSendPacingOverride(dir);
    clearSendPacingOverride(dir);

    expect(readSendPacingOverride(dir)).toBeUndefined();
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  describe('a file that cannot be used never throws and falls back to the environment policy', () => {
    beforeEach(() => {
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it.each<[string, string]>([
      ['truncated JSON', '{"enabled": tr'],
      ['an empty file', ''],
      ['JSON that is not an object', '[1,2,3]'],
      ['the literal null', 'null'],
      ['an unknown field', '{"enabled":true,"sneaky":1}'],
      ['a wrong type', '{"enabled":"yes"}'],
      ['a schedule entry out of range', '{"warmupSchedule":[0]}'],
      ['an empty warm-up schedule', '{"warmupSchedule":[]}'],
      ['a too-low cooldown', '{"breakerCooldownMs":5}'],
      // One bad field poisons the lot: applying only the good half would be a policy nobody wrote.
      ['one valid and one invalid field', '{"enabled":true,"breakerThreshold":0}'],
    ])('%s', (_label, contents) => {
      writeRaw(contents);

      expect(readSendPacingOverride(dir)).toBeUndefined();
      expect(loadSendPacingConfig(dir)).toEqual(computeSendPacingConfig());
    });

    it('logs a warning naming the file', () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      writeRaw('{broken');

      readSendPacingOverride(dir);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain(path.join(dir, FILE));
    });

    it('treats an empty object as no override', () => {
      writeRaw('{}');

      expect(readSendPacingOverride(dir)).toBeUndefined();
    });
  });

  describe('merge over the environment policy', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
    });

    it('lays only the stored fields over env, so the rest keep following their env vars', () => {
      process.env.SEND_PACING_ENABLED = 'true';
      process.env.SEND_PACING_WARMUP_SCHEDULE = '5,6';
      process.env.SEND_PACING_BREAKER_THRESHOLD = '7';
      writeSendPacingOverride(dir, { warmupSchedule: [50], coldSchedule: [] });

      expect(loadSendPacingConfig(dir)).toEqual<SendPacingConfig>({
        enabled: true, // env
        warmupSchedule: [50], // override
        coldSchedule: [], // override (rule off)
        breakerThreshold: 7, // env
        breakerCooldownMs: computeSendPacingConfig().breakerCooldownMs,
      });
    });

    it('lets an override turn pacing off although env turns it on, and the reverse', () => {
      process.env.SEND_PACING_ENABLED = 'true';
      writeSendPacingOverride(dir, { enabled: false });
      expect(loadSendPacingConfig(dir).enabled).toBe(false);

      delete process.env.SEND_PACING_ENABLED;
      writeSendPacingOverride(dir, { enabled: true });
      expect(loadSendPacingConfig(dir).enabled).toBe(true);
    });
  });
});

describe('ConfigService.set on the sendPacing key', () => {
  // The runtime override relies on this: SendPacingService reads `configService.get('sendPacing')` on
  // every send, so a `set` must change what that returns — through the real ConfigModule wiring, not
  // a hand-built stub. @nestjs/config looks at its internal config before process.env.
  it('changes what get() returns for the next reader', async () => {
    const boot = { ...computeSendPacingConfig({}), enabled: false };
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ ignoreEnvFile: true, load: [() => ({ sendPacing: boot })] })],
    }).compile();
    const config = moduleRef.get(ConfigService);
    expect(resolveSendPacingConfig(config)).toEqual(boot);

    const next: SendPacingConfig = { ...boot, enabled: true, warmupSchedule: [99] };
    config.set('sendPacing', next);

    expect(resolveSendPacingConfig(config)).toEqual(next);
    expect(config.get<SendPacingConfig>('sendPacing')?.warmupSchedule).toEqual([99]);
    // set() mirrors the value into process.env as a string; that stray key must not shadow the object.
    delete process.env.sendPacing;
  });
});
