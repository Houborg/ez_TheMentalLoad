'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Lock, LogIn, User } from 'lucide-react';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { message?: string };
        setError(data.message ?? 'Login failed. Please try again.');
        return;
      }

      const destination = searchParams.get('from') ?? '/';
      router.push(destination);
      router.refresh();
    } catch {
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Lock className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">The Mental Load</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">Sign in to access your dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Username field */}
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  required
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                  placeholder="Enter your username"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password field */}
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[oklch(0.45_0_0)]" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg pl-9 pr-10 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                  placeholder="Enter your password"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[oklch(0.45_0_0)] hover:text-[oklch(0.65_0_0)] transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Error message */}
            {error && (
              <div
                role="alert"
                className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5"
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>

        <p className="text-center text-[oklch(0.4_0_0)] text-xs mt-6">
          MentalLoad Dashboard &mdash; Internal access only
        </p>
      </div>
    </div>
  );
}
