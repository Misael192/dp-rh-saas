import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Request } from 'express';
import { RedisService } from './redis.service';
import { AppConfig } from './config';

export function trustedClientIp(request: Pick<Request, 'headers' | 'ip' | 'socket'>, proxySecret?: string): string {
  const key = request.headers['x-peopleflow-proxy-key'];
  const claimedIp = request.headers['x-peopleflow-client-ip'];
  if (proxySecret && typeof key === 'string' && Buffer.byteLength(key) === Buffer.byteLength(proxySecret) && timingSafeEqual(Buffer.from(key), Buffer.from(proxySecret)) && typeof claimedIp === 'string' && isIP(claimedIp)) return claimedIp;
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RedisService) private readonly redis: RedisService, @Inject(AppConfig) private readonly config: AppConfig) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.path.startsWith('/api/v1/health/')) return true;
    // Forwarded client identity is accepted only from the BFF holding the shared secret.
    // Express trust proxy remains disabled for direct callers.
    const ipHash = createHash('sha256').update(trustedClientIp(request, this.config.values.API_PROXY_SECRET)).digest('hex');
    const authWrite = request.path.startsWith('/api/v1/auth/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (!await this.redis.take(`${authWrite ? 'auth' : 'api'}:${ipHash}`, authWrite ? this.config.values.RATE_LIMIT_MAX : 300, 60)) this.reject();
    if (request.path === '/api/v1/auth/login') {
      const { tenantSlug, companySlug, email } = request.body ?? {};
      if ([tenantSlug, companySlug, email].every(value => typeof value === 'string')) {
        const identity = createHash('sha256').update(`${tenantSlug}\0${companySlug}\0${email}`.toLowerCase().slice(0, 512)).digest('hex');
        if (!await this.redis.take(`login:${identity}`, this.config.values.RATE_LIMIT_LOGIN_MAX, 300)) this.reject();
      }
    }
    return true;
  }
  private reject(): never { throw new HttpException({ code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente em alguns minutos.' }, 429); }
}
