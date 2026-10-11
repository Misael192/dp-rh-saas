import { Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from './config';

const incrementWithExpiry = `local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count`;

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private readonly prefix: string;
  constructor(@Inject(AppConfig) config: AppConfig) {
    this.prefix = config.values.REDIS_PREFIX;
    this.client = new Redis(config.values.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 5000, retryStrategy: attempt => Math.min(attempt * 200, 5000), enableOfflineQueue: false });
    this.client.on('error', () => { /* No connection URL or credentials in logs. Readiness reports failure. */ });
  }
  async onModuleInit() { await this.client.connect(); await this.client.ping(); }
  async onModuleDestroy() { this.client.disconnect(); }
  async take(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    try { return Number(await this.client.eval(incrementWithExpiry, 1, `${this.prefix}:rate:${key}`, windowSeconds)) <= limit; }
    catch { throw new ServiceUnavailableException({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Serviço temporariamente indisponível.' }); }
  }
}
