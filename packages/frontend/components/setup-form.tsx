'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Home } from 'lucide-react';

export function SetupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a family name'); return; }
    setError(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ familyName: name.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Could not save family name');
        return;
      }
      router.push('/');
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
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-4">
            <Home className="w-6 h-6 text-[oklch(0.7_0_0)]" />
          </div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Name your family</h1>
          <p className="text-[oklch(0.556_0_0)] text-sm mt-1">This will appear in your dashboard</p>
        </div>
        <div className="bg-[oklch(0.18_0_0)] border border-[oklch(0.28_0_0)] rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            <div className="space-y-1.5">
              <label htmlFor="familyName" className="text-xs font-medium text-[oklch(0.7_0_0)] uppercase tracking-wider">
                Family name
              </label>
              <input id="familyName" type="text" required autoFocus
                value={name} onChange={e => setName(e.target.value)} disabled={loading}
                className="w-full bg-[oklch(0.13_0_0)] border border-[oklch(0.3_0_0)] rounded-lg px-4 py-2.5 text-sm text-white placeholder-[oklch(0.4_0_0)] focus:outline-none focus:ring-2 focus:ring-[oklch(0.5_0_0)] focus:border-transparent transition"
                placeholder="e.g. The Houborg Family" />
            </div>
            {error && (
              <div role="alert" className="text-sm text-[oklch(0.7_0.2_27)] bg-[oklch(0.15_0.05_27)] border border-[oklch(0.3_0.1_27)] rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading || !name.trim()}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors">
              {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? 'Saving…' : 'Continue'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
