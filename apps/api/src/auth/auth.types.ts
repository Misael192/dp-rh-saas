import { Role } from '@prisma/client';

export interface SessionUser {
  id: string; name: string; email: string; role: Role; tenantId: string; companyId: string; companyName: string; tenantName: string; mfaEnabled: boolean;
}
export interface AuthUser extends SessionUser { sessionId: string; tokenVersion: number; }
export interface AccessClaims { sub: string; tenantId: string; companyId: string; sessionId: string; version: number; }
