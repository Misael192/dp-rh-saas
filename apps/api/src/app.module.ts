import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from './common/config';
import { RedisService } from './common/redis.service';
import { HealthController } from './common/health.controller';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { CsrfGuard } from './auth/csrf.guard';
import { RolesGuard } from './auth/roles.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { EmployeesModule } from './employees/employees.module';

@Global()
@Module({ providers: [AppConfig, RedisService], exports: [AppConfig, RedisService] })
class ConfigurationModule {}

@Module({
  imports: [ConfigurationModule, DatabaseModule, AuthModule, EmployeesModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
