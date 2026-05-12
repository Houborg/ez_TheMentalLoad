import type { FastifyInstance } from 'fastify';
import '@fastify/cookie';
import type { Pool } from 'pg';
import { AuthService, AuthError, verifyToken } from './auth-service';
import { MailService } from '../mail/mail-service';

const COOKIE_NAME = 'ml_session';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  };
}

function isSecure(request: { headers: Record<string, string | string[] | undefined> }): boolean {
  return request.headers['x-forwarded-proto'] === 'https';
}

export async function registerAuthRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const authService = new AuthService(pool);
  const mailService = new MailService();

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/signup', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || !email.trim()) {
      reply.code(400); return { message: 'email is required' };
    }
    if (typeof password !== 'string' || password.length < 8) {
      reply.code(400); return { message: 'password must be at least 8 characters' };
    }

    try {
      const { token } = await authService.signup(email, password);
      reply.setCookie(COOKIE_NAME, token, cookieOptions(isSecure(request)));
      reply.code(201);
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });

  app.post<{ Body: { email?: string; password?: string } }>('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      reply.code(400); return { message: 'email and password are required' };
    }

    try {
      const { token } = await authService.login(email, password);
      reply.setCookie(COOKIE_NAME, token, cookieOptions(isSecure(request)));
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (!token) { reply.code(401); return { message: 'Not authenticated' }; }
    try {
      const payload = verifyToken(token);
      const familyName = await authService.getFamilyName(payload.familyId);
      return { userId: payload.userId, familyId: payload.familyId, role: payload.role, familyName };
    } catch {
      reply.code(401); return { message: 'Invalid or expired session' };
    }
  });

  app.post<{ Body: { familyName?: string } }>('/api/auth/setup', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];
    if (!token) { reply.code(401); return { message: 'Not authenticated' }; }
    const name = request.body?.familyName?.trim();
    if (!name) { reply.code(400); return { message: 'familyName is required' }; }
    try {
      const payload = verifyToken(token);
      await authService.setFamilyName(payload.familyId, name);
      return { ok: true };
    } catch {
      reply.code(401); return { message: 'Invalid or expired session' };
    }
  });

  app.post<{ Body: { email?: string } }>('/api/auth/forgot-password', async (request, reply) => {
    const email = request.body?.email?.trim();
    if (!email) { reply.code(400); return { message: 'email is required' }; }

    const result = await authService.createResetToken(email);
    if (result) {
      const appUrl = process.env.APP_URL ?? 'http://localhost:5173';
      const resetUrl = `${appUrl}/reset-password?token=${result.raw}`;
      const smtpConfig = {
        smtpHost: process.env.SMTP_HOST ?? '',
        smtpPort: Number(process.env.SMTP_PORT ?? 1025),
        smtpUser: process.env.SMTP_USER ?? '',
        smtpPass: process.env.SMTP_PASS ?? '',
        smtpFrom: process.env.SMTP_FROM ?? 'mental-load@local.test',
        imapHost: '', imapPort: 993, imapUser: '', imapPass: '',
        imapSecure: true, testRecipient: '', previewMode: !process.env.SMTP_HOST,
      };
      try {
        await mailService.sendMail({
          to: email,
          subject: 'Reset your MentalLoad password',
          text: `Click the link to reset your password (expires in 1 hour):\n\n${resetUrl}`,
        }, smtpConfig);
      } catch {
        // Swallow email errors — always return 200 to avoid email enumeration
        console.error('Failed to send password reset email to', email);
      }
    }

    // Always 200 — don't reveal whether email is registered
    return { ok: true, message: 'If that email is registered, a reset link has been sent.' };
  });

  app.post<{ Body: { token?: string; password?: string } }>('/api/auth/reset-password', async (request, reply) => {
    const { token: rawToken, password } = request.body ?? {};
    if (typeof rawToken !== 'string' || !rawToken) {
      reply.code(400); return { message: 'token is required' };
    }
    if (typeof password !== 'string' || password.length < 8) {
      reply.code(400); return { message: 'password must be at least 8 characters' };
    }

    try {
      await authService.resetPassword(rawToken, password);
      return { ok: true };
    } catch (err) {
      if (err instanceof AuthError) {
        reply.code(err.status); return { message: err.message };
      }
      throw err;
    }
  });
}
