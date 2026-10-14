import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { ToStrictBoolean, ToStrictNumber } from '../../../common/utils/strict-boolean';
import {
  MAX_DAILY_CAP,
  MIN_BREAKER_COOLDOWN_MS,
  MIN_BREAKER_THRESHOLD,
  MIN_DAILY_CAP,
} from '../../message/send-pacing.config';

/** Longest schedule accepted; the last entry already applies to every later day, so 60 is generous. */
export const MAX_SCHEDULE_LENGTH = 60;

const present = (_: unknown, value: unknown): boolean => value !== undefined;

/**
 * Body for PUT /infra/send-pacing: a partial runtime override of the send-pacing policy. Every field
 * is optional and an absent one is left as it was.
 *
 * Deliberately STRICT, unlike the env parser (`computeSendPacingConfig`), which falls back to a
 * default on a bad value: that is right for a typo in a deployment variable but wrong for a request,
 * where a silently different ramp than the caller wrote is the failure this feature exists to prevent.
 * Anything out of range, mistyped or unknown is a 400 and nothing is applied.
 *
 * `@ValidateIf(v !== undefined)` rather than `@IsOptional()`: the latter also skips `null`, which would
 * let `{"coldSchedule": null}` through as a silent no-op while the caller believed the rule was changed.
 */
export class UpdateSendPacingDto {
  @ApiPropertyOptional({ description: 'Turn the pacing policy on or off' })
  @ToStrictBoolean()
  @ValidateIf(present)
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    type: [Number],
    minItems: 1,
    maxItems: MAX_SCHEDULE_LENGTH,
    description: 'Daily send allowance by session age in days; the last entry covers every later day',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SCHEDULE_LENGTH)
  @IsInt({ each: true })
  @Min(MIN_DAILY_CAP, { each: true })
  @Max(MAX_DAILY_CAP, { each: true })
  warmupSchedule?: number[];

  @ApiPropertyOptional({
    type: [Number],
    minItems: 0,
    maxItems: MAX_SCHEDULE_LENGTH,
    description: 'Daily allowance of new conversations by session age in days; an empty array turns the rule off',
  })
  @ValidateIf(present)
  @IsArray()
  @ArrayMaxSize(MAX_SCHEDULE_LENGTH)
  @IsInt({ each: true })
  @Min(MIN_DAILY_CAP, { each: true })
  @Max(MAX_DAILY_CAP, { each: true })
  coldSchedule?: number[];

  @ApiPropertyOptional({
    minimum: MIN_BREAKER_THRESHOLD,
    description: 'Consecutive send failures that trip the breaker',
  })
  @ToStrictNumber()
  @ValidateIf(present)
  @IsInt()
  @Min(MIN_BREAKER_THRESHOLD)
  breakerThreshold?: number;

  @ApiPropertyOptional({ minimum: MIN_BREAKER_COOLDOWN_MS, description: 'How long the open breaker blocks sends' })
  @ToStrictNumber()
  @ValidateIf(present)
  @IsInt()
  @Min(MIN_BREAKER_COOLDOWN_MS)
  breakerCooldownMs?: number;
}
