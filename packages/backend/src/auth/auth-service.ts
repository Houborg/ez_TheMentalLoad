import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';

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

  async signup(email: string, password: string): Promise<{ token: string; familyId: string }> {
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
    return { token, familyId };
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

  async setFamilyName(familyId: string, name: string): Promise<void> {
    await this.pool.query('update families set name = $1 where id = $2', [name.trim(), familyId]);
  }

  async getFamilyName(familyId: string): Promise<string | null> {
    const result = await this.pool.query<{ name: string | null }>('select name from families where id = $1', [familyId]);
    return result.rows[0]?.name ?? null;
  }
}
