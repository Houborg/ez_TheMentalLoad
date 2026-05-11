'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock } from 'lucide-react';
import Link from 'next/link';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Reset failed');
        return;
      }
      setDone(true);
      setTimeout(() => router.push('/login'), 2000);
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Lock className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">New password</h1>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          {done ? (
            <p className="text-center text-[oklch(0.7_0_0)] text-sm">
              Password updated! Redirecting to sign in…
            </p>
          ) : !token ? (
            <p className="text-center text-[oklch(0.7_0.2_27)] text-sm">
              Invalid or missing reset token.{' '}
              <Link href="/forgot-password" className="text-white hover:underline">Request a new one</Link>.
            </p>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="password" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">
                  New password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="password" type="password" required autoComplete="new-password"
                    value={password} onChange={e => setPassword(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="Min. 8 characters" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="confirm" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">
                  Confirm password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="confirm" type="password" required autoComplete="new-password"
                    value={confirm} onChange={e => setConfirm(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="Repeat new password" />
                </div>
              </div>
              {error && (
                <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || !password || !confirm}
                className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
                {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? 'Saving…' : 'Set new password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
