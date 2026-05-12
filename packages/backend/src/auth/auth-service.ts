import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import type { SystemMailService } from '../mail/system-mail-service';

export interface JwtPayload {
  userId: string;
  familyId: string;
  role: 'admin' | 'member';
}

function getSecret(): string {
  return process.env.AUTH_SECRET ?? 'dev-secret-please-set-AUTH_SECRET';
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: '30d', algorithm: 'HS256' });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, getSecret()) as JwtPayload;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}

export class AuthService {
  constructor(private readonly pool: Pool) {}

  async signup(email: string, password: string): Promise<{ token: string; familyId: string; userId: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const existing = await this.pool.query('select id from users where email = $1', [normalizedEmail]);
    if ((existing.rowCount ?? 0) > 0) {
      throw new AuthError('Email already registered', 409);
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const familyResult = await this.pool.query<{ id: string }>(
      'insert into families default values returning id',
    );
    const familyId = familyResult.rows[0]!.id;

    const userResult = await this.pool.query<{ id: string }>(
      'insert into users (email, password_hash, family_id, role) values ($1, $2, $3, $4) returning id',
      [normalizedEmail, passwordHash, familyId, 'admin'],
    );
    const userId = userResult.rows[0]!.id;

    const token = signToken({ userId, familyId, role: 'admin' });
    return { token, familyId, userId };
  }

  async login(email: string, password: string): Promise<{ token: string; familyId: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    const result = await this.pool.query<{
      id: string; password_hash: string; family_id: string; role: string;
    }>(
      'select id, password_hash, family_id, role from users where email = $1',
      [normalizedEmail],
    );

    const user = result.rows[0];
    // Constant-time comparison even on a cache miss — always run bcrypt
    const hash = user?.password_hash ?? '$2b$12$invalidhashforstalling000000000000000000000000000000';
    const valid = await bcrypt.compare(password, hash);

    if (!user || !valid) {
      throw new AuthError('Invalid credentials', 401);
    }

    const token = signToken({
      userId: user.id,
      familyId: user.family_id,
      role: user.role as 'admin' | 'member',
    });
    return { token, familyId: user.family_id };
  }

  async createResetToken(email: string): Promise<{ raw: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    const result = await this.pool.query<{ id: string }>(
      'select id from users where email = $1',
      [normalizedEmail],
    );
    const user = result.rows[0];
    if (!user) return null; // Don't reveal whether email exists

    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing unused tokens for this user
    await this.pool.query(
      'update reset_tokens set used_at = now() where user_id = $1 and used_at is null',
      [user.id],
    );

    await this.pool.query(
      'insert into reset_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)',
      [user.id, hash, expiresAt.toISOString()],
    );

    return { raw };
  }

  async createVerificationToken(userId: string): Promise<{ raw: string }> {
    const raw = crypto.randomBytes(32).toString('hex');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await this.pool.query(
      'update verification_tokens set used_at = now() where user_id = $1 and used_at is null',
      [userId],
    );

    await this.pool.query(
      'insert into verification_tokens (user_id, token_hash, expires_at) values ($1, $2, $3)',
      [userId, hash, expiresAt.toISOString()],
    );

    return { raw };
  }

  async verifyEmailToken(rawToken: string): Promise<{ userId: string; familyId: string }> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await this.pool.query<{
      id: string; user_id: string; expires_at: string; used_at: string | null;
    }>(
      'select id, user_id, expires_at, used_at from verification_tokens where token_hash = $1',
      [hash],
    );

    const token = result.rows[0];
    if (!token || token.used_at !== null || new Date(token.expires_at) < new Date()) {
      throw new AuthError('Verification link is invalid or has expired', 400);
    }

    await this.pool.query('update users set email_verified = true where id = $1', [token.user_id]);
    await this.pool.query('update verification_tokens set used_at = now() where id = $1', [token.id]);

    const userResult = await this.pool.query<{ family_id: string }>(
      'select family_id from users where id = $1',
      [token.user_id],
    );

    return { userId: token.user_id, familyId: userResult.rows[0]!.family_id };
  }

  async resendVerificationToken(userId: string): Promise<{ raw: string }> {
    return this.createVerificationToken(userId);
  }

  async resetPassword(rawToken: string, newPassword: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await this.pool.query<{
      id: string; user_id: string; expires_at: string; used_at: string | null;
    }>(
      'select id, user_id, expires_at, used_at from reset_tokens where token_hash = $1',
      [hash],
    );

    const token = result.rows[0];
    if (!token || token.used_at !== null || new Date(token.expires_at) < new Date()) {
      throw new AuthError('Reset token is invalid or expired', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await this.pool.query('update users set password_hash = $1 where id = $2', [passwordHash, token.user_id]);
    await this.pool.query('update reset_tokens set used_at = now() where id = $1', [token.id]);
  }

  async setFamilyName(familyId: string, name: string, systemMailService: SystemMailService): Promise<void> {
    const trimmed = name.trim();
    await this.pool.query('update families set name = $1 where id = $2', [trimmed, familyId]);

    // Create the shared Family calendar if this family doesn't have one yet
    const existing = await this.pool.query(
      'select 1 from calendars where family_id = $1 and owner_member_id is null limit 1',
      [familyId],
    );
    if ((existing.rowCount ?? 0) === 0) {
      await this.pool.query(
        `insert into calendars (id, name, color, owner_member_id, family_id, created_at)
         values (gen_random_uuid(), $1, $2, null, $3, now())`,
        [trimmed, '#10b981', familyId],
      );
    }

    // Fire-and-forget welcome email — never blocks the response
    void this.sendWelcomeEmail(familyId, trimmed, systemMailService);
  }

  private async sendWelcomeEmail(familyId: string, familyName: string, systemMailService: SystemMailService): Promise<void> {
    try {
      const userResult = await this.pool.query<{ email: string }>(
        'select email from users where family_id = $1 order by created_at asc limit 1',
        [familyId],
      );
      const email = userResult.rows[0]?.email;
      if (!email) return;

      let body: string;
      try {
        body = await this.generateWelcomeBody(familyName);
      } catch {
        body = this.welcomeFallback(familyName);
      }

      await systemMailService.sendWelcomeEmail(email, familyName, body);
    } catch (err) {
      console.error('[welcome-email] failed:', err instanceof Error ? err.message : err);
    }
  }

  private async generateWelcomeBody(familyName: string): Promise<string> {
    const ollamaUrl = process.env.OLLAMA_URL?.trim() || 'http://127.0.0.1:11434';
    const model = process.env.OLLAMA_MODEL ?? 'llama3.2:3b';

    const prompt = `Du er en venlig og varm velkomst-assistent for MentalLoad — en familie-app til kalender, opgaver og madplan.\nSkriv en kort, personlig velkomstmail (3-5 sætninger) til familien "${familyName}".\nVær varm, lidt humoristisk og uformel. Nævn at de nu kan organisere hverdagen samlet ét sted.\nUndgå emojis. Svar KUN med selve mailteksten — ingen emnelinjer, ingen hilsner udefra.`;

    const response = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error(`Ollama returned ${response.status}`);
    const data = await response.json() as { response?: string };
    const text = data.response?.trim();
    if (!text) throw new Error('Empty Ollama response');
    return text;
  }

  private welcomeFallback(familyName: string): string {
    return `Velkommen til MentalLoad, familie ${familyName}!\n\nVi er glade for at have jer med. Nu kan hele familien holde styr på kalenderen, opgaverne og madplanen ét samlet sted.\n\nGod fornøjelse!\n— MentalLoad`;
  }

  async getFamilyName(familyId: string): Promise<string | null> {
    const result = await this.pool.query<{ name: string | null }>('select name from families where id = $1', [familyId]);
    return result.rows[0]?.name ?? null;
  }
}
