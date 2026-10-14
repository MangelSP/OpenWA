// StorageService (imported transitively by the infra module) pulls in `archiver` v8, which is
// ESM-only and cannot be parsed by ts-jest; the controller under test never touches it.
jest.mock('archiver', () => ({ default: jest.fn() }));

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BadRequestException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Repository } from 'typeorm';
import { InfraSendPacingController } from './infra-send-pacing.controller';
import { UpdateSendPacingDto } from './dto/send-pacing.dto';
import { REQUIRED_ROLE_KEY, UNSCOPED_KEY } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { SendPacingService } from '../message/send-pacing.service';
import {
  computeSendPacingConfig,
  resolveSendPacingConfig,
  SEND_PACING_DEFAULTS,
  type SendPacingConfig,
} from '../message/send-pacing.config';
import type { Message } from '../message/entities/message.entity';
import type { Session } from '../session/entities/session.entity';

const dto = (fields: Partial<UpdateSendPacingDto>): UpdateSendPacingDto =>
  Object.assign(new UpdateSendPacingDto(), fields);

describe('InfraSendPacingController', () => {
  let dir: string;
  let config: ConfigService;
  let audit: { logInfo: jest.Mock };
  let controller: InfraSendPacingController;
  const savedEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('SEND_PACING_')) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-pacing-ctl-'));
    // What boot would have put there: env policy only, dataDir pointing at the tmp dir.
    config = new ConfigService({ dataDir: dir, sendPacing: computeSendPacingConfig() });
    audit = { logInfo: jest.fn().mockResolvedValue(null) };
    controller = new InfraSendPacingController(config, audit as never);
  });
  afterEach(() => {
    process.env = { ...savedEnv };
    delete process.env.sendPacing; // ConfigService.set mirrors its value into process.env
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('access control', () => {
    const reflector = new Reflector();
    // The handler is only ever a lookup key for reflector metadata and is never invoked.
    const handlers = InfraSendPacingController.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;

    it.each(['getSendPacing', 'updateSendPacing', 'resetSendPacing'])('%s requires the ADMIN role', method => {
      expect(reflector.get<ApiKeyRole | undefined>(REQUIRED_ROLE_KEY, handlers[method])).toBe(ApiKeyRole.ADMIN);
    });

    it('refuses session-scoped keys at class level, whatever their role', () => {
      expect(reflector.get<boolean | undefined>(UNSCOPED_KEY, InfraSendPacingController)).toBe(true);
    });
  });

  describe('GET', () => {
    it('reports the env policy as the effective one when nothing is overridden', () => {
      process.env.SEND_PACING_ENABLED = 'true';
      config.set('sendPacing', computeSendPacingConfig());

      const state = controller.getSendPacing();

      expect(state.source).toBe('env');
      expect(state.effective.enabled).toBe(true);
      expect(state.effective).toEqual(state.envDefaults);
      expect(state.defaults).toEqual(SEND_PACING_DEFAULTS);
      expect(state.defaults.warmupSchedule).toEqual([20, 40, 80, 160, 320, 640, 1000]);
    });
  });

  describe('PUT', () => {
    it('applies at once to what the next reader of the config sees', async () => {
      const state = await controller.updateSendPacing(dto({ enabled: true, warmupSchedule: [7, 8] }));

      expect(resolveSendPacingConfig(config)).toMatchObject({ enabled: true, warmupSchedule: [7, 8] });
      expect(state.effective).toEqual(resolveSendPacingConfig(config));
      expect(state.source).toBe('override');
      // The environment policy underneath is reported untouched.
      expect(state.envDefaults).toEqual(computeSendPacingConfig());
    });

    it('persists the override to the data dir', async () => {
      await controller.updateSendPacing(dto({ coldSchedule: [], breakerThreshold: 2 }));

      expect(JSON.parse(fs.readFileSync(path.join(dir, 'send-pacing.json'), 'utf8'))).toEqual({
        coldSchedule: [],
        breakerThreshold: 2,
      });
    });

    it('merges into the earlier override instead of replacing it, and leaves other fields on env', async () => {
      process.env.SEND_PACING_BREAKER_COOLDOWN_MS = '60000';
      await controller.updateSendPacing(dto({ enabled: true }));
      await controller.updateSendPacing(dto({ warmupSchedule: [50] }));

      expect(resolveSendPacingConfig(config)).toEqual<SendPacingConfig>({
        ...computeSendPacingConfig(),
        enabled: true,
        warmupSchedule: [50],
      });
      expect(resolveSendPacingConfig(config).breakerCooldownMs).toBe(60000);
    });

    it('rejects a body with no field and changes nothing', async () => {
      await expect(controller.updateSendPacing(dto({}))).rejects.toBeInstanceOf(BadRequestException);

      expect(fs.readdirSync(dir)).toEqual([]);
      expect(audit.logInfo).not.toHaveBeenCalled();
    });

    it('applies nothing when the override cannot be persisted', async () => {
      fs.writeFileSync(path.join(dir, 'blocker'), '');
      const stuck = new InfraSendPacingController(
        new ConfigService({ dataDir: path.join(dir, 'blocker'), sendPacing: computeSendPacingConfig() }),
        audit as never,
      );
      const before = resolveSendPacingConfig(config);

      await expect(stuck.updateSendPacing(dto({ enabled: true }))).rejects.toThrow();

      expect(resolveSendPacingConfig(config)).toEqual(before);
      expect(audit.logInfo).not.toHaveBeenCalled();
    });

    it('audits the change with the new values', async () => {
      await controller.updateSendPacing(dto({ warmupSchedule: [12] }));

      const [action, context] = audit.logInfo.mock.calls[0] as [AuditAction, { metadata: Record<string, unknown> }];
      expect(action).toBe(AuditAction.INFRA_SEND_PACING_UPDATED);
      expect(context.metadata.changed).toEqual({ warmupSchedule: [12] });
      expect(context.metadata.effective).toEqual(resolveSendPacingConfig(config));
    });
  });

  describe('DELETE', () => {
    it('drops the override, restores the env policy and removes the file', async () => {
      process.env.SEND_PACING_ENABLED = 'true';
      await controller.updateSendPacing(dto({ enabled: false, warmupSchedule: [3] }));

      const state = await controller.resetSendPacing();

      expect(state.source).toBe('env');
      expect(resolveSendPacingConfig(config)).toEqual(computeSendPacingConfig());
      expect(resolveSendPacingConfig(config).enabled).toBe(true);
      expect(fs.existsSync(path.join(dir, 'send-pacing.json'))).toBe(false);
      expect(audit.logInfo).toHaveBeenLastCalledWith(AuditAction.INFRA_SEND_PACING_RESET, {
        metadata: { effective: state.effective },
      });
    });

    it('is harmless when there is no override', async () => {
      await expect(controller.resetSendPacing()).resolves.toMatchObject({ source: 'env' });
    });
  });

  describe('against the pacing service', () => {
    const DAY_MS = 86_400_000;
    // A session created today, with 25 sends already stored for the day.
    const pacing = (sentToday: number): SendPacingService =>
      new SendPacingService(
        { count: jest.fn().mockResolvedValue(sentToday) } as unknown as Repository<Message>,
        {
          findOne: jest.fn().mockResolvedValue({ id: 's1', createdAt: new Date(Date.now() - 0 * DAY_MS) }),
        } as unknown as Repository<Session>,
        config,
      );

    const refusal = async (promise: Promise<unknown>): Promise<string | undefined> =>
      promise.then(
        () => undefined,
        (e: HttpException) => (e.getResponse() as { message: string }).message,
      );

    it('moves the allowance of a day-0 session as soon as the schedule changes, and back on reset', async () => {
      process.env.SEND_PACING_ENABLED = 'true';
      config.set('sendPacing', computeSendPacingConfig());
      const service = pacing(25);

      // Default ramp: 20 on day 0, so 25 sent is over.
      expect(await refusal(service.assertSendAllowed('s1'))).toContain('allowance of 20 reached');

      await controller.updateSendPacing(dto({ warmupSchedule: [30] }));
      await expect(service.assertSendAllowed('s1')).resolves.toBeUndefined();

      await controller.updateSendPacing(dto({ warmupSchedule: [25] }));
      expect(await refusal(service.assertSendAllowed('s1'))).toContain('allowance of 25 reached');

      await controller.resetSendPacing();
      expect(await refusal(service.assertSendAllowed('s1'))).toContain('allowance of 20 reached');
    });

    it('turns the whole policy off at runtime although env has it on', async () => {
      process.env.SEND_PACING_ENABLED = 'true';
      config.set('sendPacing', computeSendPacingConfig());
      const service = pacing(10_000);
      expect(await refusal(service.assertSendAllowed('s1'))).toBeDefined();

      await controller.updateSendPacing(dto({ enabled: false }));

      await expect(service.assertSendAllowed('s1')).resolves.toBeUndefined();
    });
  });
});
