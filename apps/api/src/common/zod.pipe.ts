import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodTypeAny } from 'zod';

@Injectable()
export class ZodPipe implements PipeTransform {
  constructor(private readonly schema: ZodTypeAny) {}
  transform(value: unknown) {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Dados inválidos.', fields: parsed.error.issues.map(issue => ({ field: issue.path.join('.'), code: issue.code })) });
    }
    return parsed.data;
  }
}
