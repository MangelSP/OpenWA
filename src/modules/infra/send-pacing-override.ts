import * as fs from 'fs';
import * as path from 'path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { createLogger } from '../../common/services/logger.service';
import { computeSendPacingConfig, type SendPacingConfig } from '../message/send-pacing.config';
import { UpdateSendPacingDto } from './dto/send-pacing.dto';

/**
 * Runtime override of the send-pacing policy, kept as JSON in the data dir (the volume that survives a
 * redeploy) and merged over the env-derived policy. Sparse on purpose: only the fields an admin set
 * are stored, so every other field keeps following its env var.
 */
export type SendPacingOverride = Partial<SendPacingConfig>;

const FILE_NAME = 'send-pacing.json';
const KEYS = ['enabled', 'warmupSchedule', 'coldSchedule', 'breakerThreshold', 'breakerCooldownMs'] as const;

const overridePath = (dataDir: string): string => path.join(dataDir, FILE_NAME);

/** The fields a DTO actually carries, as a plain object. */
export function pickSendPacingOverride(dto: UpdateSendPacingDto): SendPacingOverride {
  return Object.fromEntries(KEYS.filter(key => dto[key] !== undefined).map(key => [key, dto[key]]));
}

/**
 * The stored override, or undefined when there is none. A file that cannot be used — unreadable, not
 * JSON, or holding anything the PUT route would have refused (a hand edit) — is logged and ignored
 * WHOLE rather than partly applied: it must never stop the boot, and a half-applied policy would be a
 * silently different ramp than anyone wrote.
 */
export function readSendPacingOverride(dataDir: string): SendPacingOverride | undefined {
  const file = overridePath(dataDir);
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not a JSON object');
    const dto = plainToInstance(UpdateSendPacingDto, parsed);
    const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new Error(errors.map(e => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; '));
    }
    const override = pickSendPacingOverride(dto);
    return Object.keys(override).length > 0 ? override : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      createLogger('SendPacingOverride').warn(`Ignoring ${file}; using the environment policy`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return undefined;
  }
}

/** Tmp file + rename, so a crash mid-write leaves the previous complete file rather than a torn one. */
export function writeSendPacingOverride(dataDir: string, override: SendPacingOverride): void {
  const file = overridePath(dataDir);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(override, null, 2));
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export function clearSendPacingOverride(dataDir: string): void {
  fs.rmSync(overridePath(dataDir), { force: true });
}

/** The policy in force: the env-derived one with the stored override laid over it. */
export function loadSendPacingConfig(dataDir: string): SendPacingConfig {
  return { ...computeSendPacingConfig(), ...readSendPacingOverride(dataDir) };
}
