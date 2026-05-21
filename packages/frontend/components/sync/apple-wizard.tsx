'use client';

import { useState } from 'react';
import type { RemoteCalendar, SyncConnection } from '@mental-load/contracts';
import {
  verifySyncConnection,
  listRemoteCalendars,
  createSyncConnection,
} from '../../lib/api-sync-connections';

interface AppleWizardProps {
  onComplete: (connection: SyncConnection) => void;
  onCancel: () => void;
}

type Step = 1 | 2 | 3 | 4 | 5;

export function AppleWizard({ onComplete, onCancel }: AppleWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const caldavUrl = 'https://caldav.icloud.com';
  const [remoteCalendars, setRemoteCalendars] = useState<RemoteCalendar[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState<RemoteCalendar | null>(null);
  const [importEnabled, setImportEnabled] = useState(true);
  const [exportEnabled, setExportEnabled] = useState(true);
  const [finalConnection, setFinalConnection] = useState<SyncConnection | null>(null);

  async function handleVerify() {
    setError('');
    setBusy(true);
    try {
      const result = await verifySyncConnection({ provider: 'apple', appleId, caldavUrl, appPassword });
      if (!result.ok) { setError(result.message); return; }
      const { calendars } = await listRemoteCalendars({ provider: 'apple', appleId, caldavUrl, appPassword });
      setRemoteCalendars(calendars);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleFinish() {
    if (!selectedCalendar) return;
    setError('');
    setBusy(true);
    try {
      const conn = await createSyncConnection({
        provider: 'apple',
        importEnabled,
        exportEnabled,
        appleId,
        caldavUrl,
        appPassword,
        calendarPath: selectedCalendar.url,
        calendarName: selectedCalendar.displayName,
      });
      setFinalConnection(conn);
      setStep(5);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save connection');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {([1, 2, 3, 4, 5] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center" style={{ flex: s < 5 ? '1' : undefined }}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold
              ${step > s ? 'bg-green-500 text-black' : step === s ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
              {step > s ? '✓' : s}
            </div>
            {i < 4 && <div className={`h-0.5 flex-1 ${step > s ? 'bg-primary' : 'bg-border/40'}`} />}
          </div>
        ))}
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {/* Step 1 — Apple ID */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 1 of 5</p>
            <h3 className="text-base font-bold">Enter your Apple ID</h3>
            <p className="text-sm text-muted-foreground">The email you use for iCloud — usually @icloud.com, @me.com, or your own address.</p>
          </div>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Apple ID (iCloud email)</span>
            <input
              type="email"
              value={appleId}
              onChange={(e) => setAppleId(e.target.value)}
              placeholder="far@icloud.com"
              className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm outline-none focus:border-primary/60"
            />
          </label>
          <p className="text-xs text-muted-foreground">Your main Apple ID password is never stored — we use a separate app-specific password in the next step.</p>
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">Cancel</button>
            <button
              onClick={() => setStep(2)}
              disabled={!appleId.includes('@')}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Continue →</button>
          </div>
        </div>
      )}

      {/* Step 2 — App-specific password */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 2 of 5</p>
            <h3 className="text-base font-bold">Create an app-specific password</h3>
            <p className="text-sm text-muted-foreground">Apple requires a one-time password for apps connecting to iCloud. Takes about 60 seconds.</p>
          </div>
          <ol className="flex flex-col gap-2">
            {[
              <span key="1">Open <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">appleid.apple.com</a> and sign in</span>,
              <span key="2">Go to <strong>Sign-In and Security</strong> → <strong>App-Specific Passwords</strong></span>,
              <span key="3">Click <strong>+</strong> and name it <code className="rounded bg-muted px-1 text-xs">MentalLoad</code></span>,
              <span key="4">Copy the password (format: <code className="rounded bg-muted px-1 text-xs">xxxx-xxxx-xxxx-xxxx</code>) and paste below</span>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 list-none">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/20 text-xs font-bold text-primary">{i + 1}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </li>
            ))}
          </ol>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">App-specific password</span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => void handleVerify()}
              disabled={busy || !appPassword}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Verifying…' : 'Connect & verify →'}</button>
          </div>
        </div>
      )}

      {/* Step 3 — Pick calendar */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 3 of 5</p>
            <h3 className="text-base font-bold">Pick your calendar</h3>
            <p className="text-sm text-muted-foreground">MentalLoad found these calendars in your iCloud account. Choose which one to sync.</p>
          </div>
          <div className="flex flex-col gap-2">
            {remoteCalendars.map((cal) => (
              <button
                key={cal.url}
                onClick={() => setSelectedCalendar(cal)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors
                  ${selectedCalendar?.url === cal.url ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/40'}`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold
                  ${selectedCalendar?.url === cal.url ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
                  {selectedCalendar?.url === cal.url ? '✓' : ''}
                </span>
                <span className="font-medium">{cal.displayName}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => setStep(4)}
              disabled={!selectedCalendar}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Use this calendar →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Direction */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Step 4 of 5</p>
            <h3 className="text-base font-bold">Sync direction</h3>
            <p className="text-sm text-muted-foreground">Choose how MentalLoad and Apple Calendar should stay in sync.</p>
          </div>
          {[
            { label: 'Import from Apple Calendar', desc: 'Apple events appear in MentalLoad automatically', value: importEnabled, set: setImportEnabled },
            { label: 'Export to Apple Calendar', desc: 'Events added in MentalLoad are pushed back to Apple Calendar', value: exportEnabled, set: setExportEnabled },
          ].map(({ label, desc, value, set }) => (
            <button
              key={label}
              onClick={() => set(!value)}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors
                ${value ? 'border-primary bg-primary/10' : 'border-border/60'}`}
            >
              <div>
                <p className="text-sm font-semibold">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              <div className={`h-5 w-9 rounded-full transition-colors ${value ? 'bg-primary' : 'bg-muted/40'}`}>
                <div className={`m-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : ''}`} />
              </div>
            </button>
          ))}
          <p className="text-xs text-muted-foreground">Both on = fully bidirectional. Import-only is the safe option if you just want to read Apple events.</p>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Back</button>
            <button
              onClick={() => void handleFinish()}
              disabled={busy || (!importEnabled && !exportEnabled)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Saving…' : 'Finish setup →'}</button>
          </div>
        </div>
      )}

      {/* Step 5 — Success */}
      {step === 5 && finalConnection && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl">✅</div>
          <div>
            <h3 className="text-base font-bold text-green-600 dark:text-green-400">Apple Calendar connected!</h3>
            <p className="text-sm text-muted-foreground">MentalLoad is now syncing with {selectedCalendar?.displayName}.</p>
          </div>
          <div className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-left">
            {([
              ['Apple ID', appleId],
              ['Calendar', selectedCalendar?.displayName ?? ''],
              ['Direction', importEnabled && exportEnabled ? 'Bidirectional' : importEnabled ? 'Import only' : 'Export only'],
              ['Auto-sync', 'Every 15 minutes'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Want to also connect Google Calendar? Use the <strong>+ Add</strong> button in the sidebar when it becomes available.</p>
          <button
            onClick={() => onComplete(finalConnection)}
            className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Done</button>
        </div>
      )}
    </div>
  );
}
