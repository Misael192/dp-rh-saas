import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class SafeErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { requestId?: string }>();
    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a operação.' };
    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const value = exception.getResponse();
      body = typeof value === 'string' ? { code: 'REQUEST_FAILED', message: value } : value as Record<string, unknown>;
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') { status = 409; body = { code: 'CONFLICT', message: 'Um registro com estes dados já existe.' }; }
      else if (exception.code === 'P2003') { status = 400; body = { code: 'INVALID_RELATION', message: 'Vínculo inválido.' }; }
      else if (exception.code === 'P2025') { status = 404; body = { code: 'NOT_FOUND', message: 'Registro não encontrado.' }; }
    } else if (exception && typeof exception === 'object' && 'type' in exception) {
      if (exception.type === 'entity.parse.failed') { status = 400; body = { code: 'INVALID_JSON', message: 'JSON inválido.' }; }
      else if (exception.type === 'entity.too.large') { status = 413; body = { code: 'PAYLOAD_TOO_LARGE', message: 'O conteúdo excede o tamanho permitido.' }; }
    }
    // Do not log exception.message/stack: Prisma may embed query parameters and authentication libraries may include secrets.
    if (status >= 500) process.stderr.write(`${JSON.stringify({ level: 'error', event: 'request.failed', requestId: request.requestId, status, errorType: exception instanceof Error ? exception.constructor.name : 'Unknown' })}\n`);
    response.status(status).json({ ...body, statusCode: status, requestId: request.requestId });
  }
}
