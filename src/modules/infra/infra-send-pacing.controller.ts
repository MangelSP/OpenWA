import { BadRequestException, Body, Controller, Delete, Get, Optional, Put } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole, RequireUnscopedKey } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { DEFAULT_DATA_DIR } from '../../config/configuration';
import {
  computeSendPacingConfig,
  resolveSendPacingConfig,
  SEND_PACING_DEFAULTS,
  type SendPacingConfig,
} from '../message/send-pacing.config';
import { InfraSendPacingResponseDto } from './dto/infra-response.dto';
import { UpdateSendPacingDto } from './dto/send-pacing.dto';
import {
  clearSendPacingOverride,
  pickSendPacingOverride,
  readSendPacingOverride,
  writeSendPacingOverride,
} from './send-pacing-override';

interface SendPacingState {
  effective: SendPacingConfig;
  source: 'env' | 'override';
  envDefaults: SendPacingConfig;
  defaults: typeof SEND_PACING_DEFAULTS;
}

@ApiTags('infrastructure')
@Controller('infra')
// Deployment-global, like every other route here: a session-scoped key is refused at class level.
@RequireUnscopedKey()
export class InfraSendPacingController {
  private readonly dataDir: string;

  constructor(
    private readonly configService: ConfigService,
    // @Optional so direct-construction specs can omit it; the running app always has the @Global one.
    @Optional()
    private readonly auditService?: AuditService,
  ) {
    this.dataDir = this.configService.get<string>('dataDir') ?? DEFAULT_DATA_DIR;
  }

  @Get('send-pacing')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Read the send-pacing policy in force, with its environment and built-in defaults' })
  @ApiResponse({ status: 200, type: InfraSendPacingResponseDto })
  getSendPacing(): SendPacingState {
    return {
      effective: resolveSendPacingConfig(this.configService),
      source: readSendPacingOverride(this.dataDir) ? 'override' : 'env',
      envDefaults: computeSendPacingConfig(),
      defaults: SEND_PACING_DEFAULTS,
    };
  }

  @Put('send-pacing')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({
    summary: 'Change the send-pacing policy at runtime',
    description:
      'Merges the given fields into the stored override, persists it to the data dir and applies it to the ' +
      'next send, with no restart. Fields left out keep their value. Strict: an invalid field rejects the ' +
      'whole request and nothing is applied.',
  })
  @ApiBody({ type: UpdateSendPacingDto })
  @ApiResponse({ status: 200, type: InfraSendPacingResponseDto })
  @ApiResponse({ status: 400, description: 'A field is invalid or unknown, or the body carries no field at all' })
  async updateSendPacing(@Body() dto: UpdateSendPacingDto): Promise<SendPacingState> {
    const changed = pickSendPacingOverride(dto);
    if (Object.keys(changed).length === 0) {
      throw new BadRequestException('Provide at least one send-pacing field to change');
    }
    // Persist first: a policy that applied but would vanish on the next restart is worse than an error.
    // Both steps are synchronous, so two concurrent updates cannot interleave their read-modify-write.
    const override = { ...readSendPacingOverride(this.dataDir), ...changed };
    writeSendPacingOverride(this.dataDir, override);
    this.configService.set('sendPacing', { ...computeSendPacingConfig(), ...override });
    const state = this.getSendPacing();
    await this.auditService?.logInfo(AuditAction.INFRA_SEND_PACING_UPDATED, {
      metadata: { changed, effective: state.effective },
    });
    return state;
  }

  @Delete('send-pacing')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Drop the runtime override and go back to the environment policy' })
  @ApiResponse({ status: 200, type: InfraSendPacingResponseDto })
  async resetSendPacing(): Promise<SendPacingState> {
    clearSendPacingOverride(this.dataDir);
    this.configService.set('sendPacing', computeSendPacingConfig());
    const state = this.getSendPacing();
    await this.auditService?.logInfo(AuditAction.INFRA_SEND_PACING_RESET, { metadata: { effective: state.effective } });
    return state;
  }
}
