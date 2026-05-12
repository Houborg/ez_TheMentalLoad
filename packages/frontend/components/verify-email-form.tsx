'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

export function VerifyEmailForm() {
  const searchParams = useSearchParams();
  const expired = searchParams.get('error') === 'expired';
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleResend() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        setError(data.message ?? 'Kunne ikke sende e-mailen igen');
        return;
      }
      setSent(true);
    } catch {
      setError('Netværksfejl. Prøv igen.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[oklch(0.145_0_0)] px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[oklch(0.205_0_0)] border border-[oklch(0.3_0_0)] mb-6">
          <Mail className="w-6 h-6 text-[oklch(0.7_0_0)]" />
        </div>
        <h1 className="text-2xl font-semibold text-white tracking-tight mb-2">Bekræft din e-mail</h1>

        {expired ? (
          <p className="text-[oklch(0.7_0.2_27)] text-sm mb-6">
            Linket er udløbet eller ugyldigt. Send et nyt nedenfor.
          </p>
        ) : (
          <p className="text-[oklch(0.556_0_0)] text-sm mb-6">
            Vi har sendt et bekræftelseslink til din e-mailadresse.<br />
            Klik på linket for at aktivere din konto.
          </p>
        )}

        {sent ? (
          <p className="text-[oklch(0.7_0_0)] text-sm">
            Et nyt link er sendt! Tjek din indbakke.
          </p>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void handleResend()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[oklch(0.75_0_0)] hover:bg-[oklch(0.85_0_0)] disabled:bg-[oklch(0.3_0_0)] disabled:cursor-not-allowed text-[oklch(0.1_0_0)] disabled:text-[oklch(0.5_0_0)] font-medium text-sm rounded-lg py-2.5 transition-colors"
            >
              {loading ? <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" /> : null}
              {loading ? 'Sender…' : 'Send linket igen'}
            </button>
            {error && (
              <p className="mt-3 text-sm text-[oklch(0.7_0.2_27)]">{error}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
