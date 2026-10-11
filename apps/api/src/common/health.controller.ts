import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Public } from '../auth/decorators';
import { RedisService } from './redis.service';

@Public() @Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(RedisService) private readonly redis: RedisService) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready() {
    try { await Promise.all([this.db.$queryRaw`SELECT 1`, this.redis.client.ping()]); return { status: 'ready' }; }
    catch { throw new ServiceUnavailableException({ code: 'NOT_READY', message: 'Dependências indisponíveis.' }); }
  }
}
