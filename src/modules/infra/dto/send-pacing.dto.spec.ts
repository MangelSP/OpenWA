import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_OPTIONS } from '../../../config/app-validation';
import { UpdateSendPacingDto } from './send-pacing.dto';

// The real pipe, built from the options production uses, so this spec also gates `whitelist` and
// `enableImplicitConversion` rather than restating them.
const pipe = new ValidationPipe(GLOBAL_VALIDATION_OPTIONS);
const run = (body: unknown): Promise<UpdateSendPacingDto> =>
  pipe.transform(body, { type: 'body', metatype: UpdateSendPacingDto }) as Promise<UpdateSendPacingDto>;

const ramp = (length: number, value = 10): number[] => Array.from({ length }, () => value);

describe('UpdateSendPacingDto', () => {
  describe('accepts', () => {
    it.each<[string, Record<string, unknown>]>([
      ['an empty body (the controller decides what an empty update means)', {}],
      ['enabled alone', { enabled: true }],
      [
        'a full valid body',
        { enabled: true, warmupSchedule: [10, 20], coldSchedule: [1], breakerThreshold: 3, breakerCooldownMs: 5000 },
      ],
      ['the boundary values', { warmupSchedule: [1, 100000], breakerThreshold: 1, breakerCooldownMs: 1000 }],
      ['a 60-entry warm-up schedule', { warmupSchedule: ramp(60) }],
      ['an empty cold schedule, which turns the rule off', { coldSchedule: [] }],
      ['a 60-entry cold schedule', { coldSchedule: ramp(60) }],
      ["form-encoded scalars ('false' stays false, '3' becomes 3)", { enabled: 'false', breakerThreshold: '3' }],
    ])('%s', async (_label, body) => {
      await expect(run(body)).resolves.toBeInstanceOf(UpdateSendPacingDto);
    });

    it("maps a form-encoded 'false' to a real false instead of the implicit cast's true", async () => {
      expect((await run({ enabled: 'false' })).enabled).toBe(false);
    });
  });

  describe('rejects with 400', () => {
    it.each<[string, Record<string, unknown>]>([
      ['an unknown field', { enabled: true, hack: 1 }],
      ['a non-boolean enabled', { enabled: 'yes' }],
      ['a numeric enabled', { enabled: 1 }],
      ['a null enabled (would be a silent no-op)', { enabled: null }],
      ['a null cold schedule (would be a silent no-op)', { coldSchedule: null }],
      ['an empty warm-up schedule', { warmupSchedule: [] }],
      ['a 61-entry warm-up schedule', { warmupSchedule: ramp(61) }],
      ['a 61-entry cold schedule', { coldSchedule: ramp(61) }],
      ['a zero entry', { warmupSchedule: [10, 0] }],
      ['a negative entry', { coldSchedule: [-1] }],
      ['an entry above 100000', { warmupSchedule: [100001] }],
      ['a fractional entry', { warmupSchedule: [10.5] }],
      ['a string entry', { warmupSchedule: ['10'] }],
      ['a comma-separated string instead of an array', { warmupSchedule: '10,20' }],
      ['a null entry', { coldSchedule: [null] }],
      ['a zero breaker threshold', { breakerThreshold: 0 }],
      ['a fractional breaker threshold', { breakerThreshold: 2.5 }],
      ['a blank breaker threshold, which the implicit cast would turn into 0', { breakerThreshold: '' }],
      ['a cooldown under one second', { breakerCooldownMs: 999 }],
      ['a non-numeric cooldown', { breakerCooldownMs: 'soon' }],
    ])('%s', async (_label, body) => {
      await expect(run(body)).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
