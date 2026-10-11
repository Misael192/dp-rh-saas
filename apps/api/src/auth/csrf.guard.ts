import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { AppConfig } from '../common/config';

export function validCsrf(origin: unknown, expectedOrigin: string, cookie: unknown, header: unknown): boolean {
  return origin === expectedOrigin && typeof cookie === 'string' && typeof header === 'string' && /^[a-f0-9]{64}$/.test(cookie) && /^[a-f0-9]{64}$/.test(header) && timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
    if (!validCsrf(request.headers.origin, this.config.values.WEB_ORIGIN, request.cookies?.csrf_token, request.headers['x-csrf-token'])) throw new ForbiddenException({ code: 'CSRF_REJECTED', message: 'Requisição não autorizada.' });
    return true;
  }
}
