import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { Request, Response, CookieOptions } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { AppConfig } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, Public } from './decorators';
import { AuthService, AuthTokens } from './auth.service';
import { AuthUser } from './auth.types';
import { changePasswordSchema, loginSchema, mfaDisableSchema, mfaEnableSchema, mfaSetupSchema } from './auth.schemas';

@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService, @Inject(AppConfig) private readonly config: AppConfig) {}
  private options(path: string): CookieOptions { return { httpOnly: true, secure: this.config.secureCookies, sameSite: 'strict', path }; }
  private setTokens(response: Response, tokens: AuthTokens) {
    response.cookie('access_token', tokens.accessToken, { ...this.options('/api/v1'), maxAge: 15 * 60 * 1000 });
    response.cookie('refresh_token', tokens.refreshToken, { ...this.options('/api/v1/auth'), maxAge: Math.max(0, tokens.refreshExpiresAt.getTime() - Date.now()) });
    response.setHeader('Cache-Control', 'no-store');
    return { user: tokens.user };
  }
  private clearTokens(response: Response) {
    response.clearCookie('access_token', this.options('/api/v1'));
    response.clearCookie('refresh_token', this.options('/api/v1/auth'));
    response.setHeader('Cache-Control', 'no-store');
  }

  @Public() @Get('csrf')
  csrf(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const existing = request.cookies?.csrf_token;
    const csrfToken = typeof existing === 'string' && /^[a-f0-9]{64}$/.test(existing) ? existing : randomBytes(32).toString('hex');
    response.cookie('csrf_token', csrfToken, { ...this.options('/api/v1'), maxAge: 8 * 60 * 60 * 1000 });
    response.setHeader('Cache-Control', 'no-store');
    return { csrfToken };
  }
  @Public() @Post('login') @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) response: Response) {
    return this.setTokens(response, await this.auth.login(body));
  }
  @Public() @Post('refresh') @HttpCode(200)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response, @Body(new ZodPipe(z.object({}).strict())) _body: unknown) {
    return this.setTokens(response, await this.auth.refresh(request.cookies?.refresh_token));
  }
  @Post('logout') @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Req() request: Request, @Res({ passthrough: true }) response: Response, @Body(new ZodPipe(z.object({}).strict())) _body: unknown) {
    await this.auth.logout(user, request.cookies?.refresh_token);
    this.clearTokens(response);
  }
  @Get('me')
  me(@CurrentUser() user: AuthUser) { return { user: this.auth.publicUser(user) }; }
  @Post('change-password') @HttpCode(204)
  async changePassword(@CurrentUser() user: AuthUser, @Body(new ZodPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @Res({ passthrough: true }) response: Response) {
    await this.auth.changePassword(user, body.currentPassword, body.newPassword);
    this.clearTokens(response);
  }
  @Post('mfa/setup') @HttpCode(200)
  setup(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaSetupSchema)) body: z.infer<typeof mfaSetupSchema>) { return this.auth.setupMfa(user, body.currentPassword); }
  @Post('mfa/enable') @HttpCode(200)
  async enable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaEnableSchema)) body: z.infer<typeof mfaEnableSchema>, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.enableMfa(user, body.code);
    this.clearTokens(response);
    return result;
  }
  @Post('mfa/disable') @HttpCode(204)
  async disable(@CurrentUser() user: AuthUser, @Body(new ZodPipe(mfaDisableSchema)) body: z.infer<typeof mfaDisableSchema>, @Res({ passthrough: true }) response: Response) {
    await this.auth.disableMfa(user, body.currentPassword, body.code);
    this.clearTokens(response);
  }
}
