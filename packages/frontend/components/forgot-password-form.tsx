'use client';

import { useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import Link from 'next/link';

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Something went wrong');
        return;
      }
      setSent(true);
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
            <Mail className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Reset password</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">{"We'll send a reset link to your email"}</p>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          {sent ? (
            <div className="text-center space-y-4">
              <p className="text-[oklch(0.7_0_0)] text-sm">
                If that email is registered, a reset link is on its way. Check your inbox.
              </p>
              <Link href="/login" className="block text-white text-sm hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-5">
              <div className="space-y-1.5">
                <label htmlFor="email" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                  <input id="email" type="email" required autoComplete="email"
                    value={email} onChange={e => setEmail(e.target.value)} disabled={loading}
                    className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                    placeholder="you@example.com" />
                </div>
              </div>
              {error && (
                <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">
                  {error}
                </div>
              )}
              <button type="submit" disabled={loading || !email}
                className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
                {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
        {!sent && (
          <p className="text-center text-[oklch(0.556_0_0)] text-sm mt-4">
            <Link href="/login" className="text-white hover:underline">Back to sign in</Link>
          </p>
        )}
      </div>
    </div>
  );
}
