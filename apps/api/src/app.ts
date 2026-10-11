import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { json, NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { AppModule } from './app.module';
import { SafeErrorFilter } from './common/error.filter';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false, bodyParser: false, abortOnError: false });
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ frameguard: { action: 'deny' } }));
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    request.requestId = randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    response.on('finish', () => {
      // Log the registered route template, never user-supplied path segments or queries.
      const path = typeof request.route?.path === 'string' && request.route.path.startsWith('/api/v1/') ? request.route.path : '/unmatched';
      process.stdout.write(`${JSON.stringify({ level: 'info', event: 'request.completed', requestId: request.requestId, method: request.method, path, status: response.statusCode, durationMs: Date.now() - started })}\n`);
    });
    next();
  });
  app.use(json({ limit: '64kb', strict: true }));
  app.use(cookieParser());
  app.useGlobalFilters(new SafeErrorFilter());
  app.enableShutdownHooks();
  try { await app.init(); } catch (error) { await app.close(); throw error; }
  return app;
}
