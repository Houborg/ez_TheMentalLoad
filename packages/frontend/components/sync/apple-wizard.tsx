'use client';

import { useEffect, useState } from 'react';
import type { Member, RemoteCalendar, SyncConnection } from '@mental-load/contracts';
import {
  verifySyncConnection,
  listRemoteCalendars,
  createSyncConnection,
  deleteSyncConnection,
} from '../../lib/api-sync-connections';
import { loadMembers } from '../../lib/api';

interface AppleWizardProps {
  onComplete: (connection: SyncConnection) => void;
  onCancel: () => void;
  existingConnectionId?: string;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6;
// target = 'shared' means family/shared calendar; any other string = a member ID
type TargetSelection = 'shared' | string | null;

export function AppleWizard({ onComplete, onCancel, existingConnectionId }: AppleWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [appleId, setAppleId] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const caldavUrl = 'https://caldav.icloud.com';
  const [remoteCalendars, setRemoteCalendars] = useState<RemoteCalendar[]>([]);
  const [selectedCalendar, setSelectedCalendar] = useState<RemoteCalendar | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<TargetSelection>(null);
  const [importEnabled, setImportEnabled] = useState(true);
  const [exportEnabled, setExportEnabled] = useState(true);
  const [finalConnection, setFinalConnection] = useState<SyncConnection | null>(null);

  useEffect(() => {
    loadMembers().then(setMembers).catch(() => {});
  }, []);

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
    if (!selectedCalendar || selectedTarget === null) return;
    setError('');
    setBusy(true);
    const isShared = selectedTarget === 'shared';
    try {
      if (existingConnectionId) {
        await deleteSyncConnection(existingConnectionId);
      }
      const conn = await createSyncConnection({
        provider: 'apple',
        importEnabled,
        exportEnabled,
        appleId,
        caldavUrl,
        appPassword,
        calendarPath: selectedCalendar.url,
        calendarName: selectedCalendar.displayName,
        isSharedCalendar: isShared,
        targetMemberId: isShared ? undefined : selectedTarget,
      });
      setFinalConnection(conn);
      setStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save connection');
    } finally {
      setBusy(false);
    }
  }

  const targetLabel =
    selectedTarget === null ? '' :
    selectedTarget === 'shared' ? 'Familie (delt kalender)' :
    (members.find((m) => m.id === selectedTarget)?.name ?? selectedTarget);

  return (
    <div className="flex flex-col gap-4">
      {/* Step indicator */}
      <div className="flex items-center gap-0">
        {([1, 2, 3, 4, 5, 6] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center" style={{ flex: s < 6 ? '1' : undefined }}>
            <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold
              ${step > s ? 'bg-green-500 text-black' : step === s ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
              {step > s ? '✓' : s}
            </div>
            {i < 5 && <div className={`h-0.5 flex-1 ${step > s ? 'bg-primary' : 'bg-border/40'}`} />}
          </div>
        ))}
      </div>

      {error && <p className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      {/* Step 1 — Apple ID */}
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trin 1 af 6</p>
            <h3 className="text-base font-bold">Indtast dit Apple ID</h3>
            <p className="text-sm text-muted-foreground">Den email du bruger til iCloud — typisk @icloud.com, @me.com eller din egen adresse.</p>
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
          <p className="text-xs text-muted-foreground">Din Apple ID adgangskode gemmes aldrig — vi bruger en app-specifik adgangskode i næste trin.</p>
          <div className="flex gap-2">
            <button onClick={onCancel} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">Annuller</button>
            <button
              onClick={() => setStep(2)}
              disabled={!appleId.includes('@')}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Fortsæt →</button>
          </div>
        </div>
      )}

      {/* Step 2 — App-specific password */}
      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trin 2 af 6</p>
            <h3 className="text-base font-bold">Opret en app-specifik adgangskode</h3>
            <p className="text-sm text-muted-foreground">Apple kræver en engangskode til apps der forbinder til iCloud. Tager ca. 60 sekunder.</p>
          </div>
          <ol className="flex flex-col gap-2">
            {[
              <span key="1">Åbn <a href="https://appleid.apple.com" target="_blank" rel="noopener noreferrer" className="text-primary underline">appleid.apple.com</a> og log ind</span>,
              <span key="2">Gå til <strong>Log ind og sikkerhed</strong> → <strong>App-specifikke adgangskoder</strong></span>,
              <span key="3">Klik <strong>+</strong> og navngiv den <code className="rounded bg-muted px-1 text-xs">MentalLoad</code></span>,
              <span key="4">Kopiér adgangskoden (format: <code className="rounded bg-muted px-1 text-xs">xxxx-xxxx-xxxx-xxxx</code>) og indsæt nedenfor</span>,
            ].map((text, i) => (
              <li key={i} className="flex gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 list-none">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/20 text-xs font-bold text-primary">{i + 1}</span>
                <span className="text-sm text-muted-foreground">{text}</span>
              </li>
            ))}
          </ol>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">App-specifik adgangskode</span>
            <input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder="xxxx-xxxx-xxxx-xxxx"
              className="rounded-xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Tilbage</button>
            <button
              onClick={() => void handleVerify()}
              disabled={busy || !appPassword}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Verificerer…' : 'Forbind og verificer →'}</button>
          </div>
        </div>
      )}

      {/* Step 3 — Pick remote calendar */}
      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trin 3 af 6</p>
            <h3 className="text-base font-bold">Vælg kalender (fra Apple)</h3>
            <p className="text-sm text-muted-foreground">MentalLoad fandt disse kalendere i din iCloud-konto. Vælg hvilken der skal synkroniseres.</p>
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
            <button onClick={() => setStep(2)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Tilbage</button>
            <button
              onClick={() => setStep(4)}
              disabled={!selectedCalendar}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Brug denne kalender →</button>
          </div>
        </div>
      )}

      {/* Step 4 — Target: shared family or specific member */}
      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trin 4 af 6</p>
            <h3 className="text-base font-bold">Hvem tilhører denne kalender?</h3>
            <p className="text-sm text-muted-foreground">
              Importerede begivenheder fra <strong>{selectedCalendar?.displayName}</strong> placeres i den valgte kalender.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            {/* Shared / family option */}
            <button
              onClick={() => setSelectedTarget('shared')}
              className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors
                ${selectedTarget === 'shared' ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/40'}`}
            >
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold
                ${selectedTarget === 'shared' ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
                {selectedTarget === 'shared' ? '✓' : '🏠'}
              </span>
              <div>
                <p className="font-semibold">Familie (delt kalender)</p>
                <p className="text-xs text-muted-foreground">Begivenheder er synlige for alle forældre på dashboardet. Godt til delte familiekalendere som "Houborg".</p>
              </div>
            </button>

            {/* Per-member options */}
            {members.map((member) => (
              <button
                key={member.id}
                onClick={() => setSelectedTarget(member.id)}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors
                  ${selectedTarget === member.id ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/40'}`}
              >
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-bold
                  ${selectedTarget === member.id ? 'bg-primary text-white' : 'bg-muted/40 text-muted-foreground'}`}>
                  {selectedTarget === member.id ? '✓' : member.avatar ?? member.name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <p className="font-semibold">{member.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{member.role === 'parent' ? 'Forælder' : 'Barn'}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Tilbage</button>
            <button
              onClick={() => setStep(5)}
              disabled={selectedTarget === null}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Fortsæt →</button>
          </div>
        </div>
      )}

      {/* Step 5 — Sync direction */}
      {step === 5 && (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">Trin 5 af 6</p>
            <h3 className="text-base font-bold">Synkroniseringsretning</h3>
            <p className="text-sm text-muted-foreground">Vælg hvordan MentalLoad og Apple Kalender skal holdes synkroniseret.</p>
          </div>
          {[
            { label: 'Importér fra Apple Kalender', desc: 'Apple-begivenheder vises automatisk i MentalLoad', value: importEnabled, set: setImportEnabled },
            { label: 'Eksportér til Apple Kalender', desc: 'Begivenheder oprettet i MentalLoad sendes tilbage til Apple Kalender', value: exportEnabled, set: setExportEnabled },
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
          <p className="text-xs text-muted-foreground">Begge slået til = fuldt tovejs. Import-kun er den sikre mulighed hvis du blot vil læse Apple-begivenheder.</p>
          <div className="flex gap-2">
            <button onClick={() => setStep(4)} className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60">← Tilbage</button>
            <button
              onClick={() => void handleFinish()}
              disabled={busy || (!importEnabled && !exportEnabled)}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >{busy ? 'Gemmer…' : 'Afslut opsætning →'}</button>
          </div>
        </div>
      )}

      {/* Step 6 — Success */}
      {step === 6 && finalConnection && (
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl">✅</div>
          <div>
            <h3 className="text-base font-bold text-green-600 dark:text-green-400">Apple Kalender tilsluttet!</h3>
            <p className="text-sm text-muted-foreground">MentalLoad synkroniserer nu med {selectedCalendar?.displayName}.</p>
          </div>
          <div className="w-full rounded-xl border border-border/60 bg-muted/20 px-4 py-3 text-left">
            {([
              ['Apple ID', appleId],
              ['Kalender (Apple)', selectedCalendar?.displayName ?? ''],
              ['Kalender (MentalLoad)', targetLabel],
              ['Retning', importEnabled && exportEnabled ? 'Tovejs' : importEnabled ? 'Kun import' : 'Kun eksport'],
              ['Auto-sync', 'Hvert 15. minut'],
            ] as [string, string][]).map(([k, v]) => (
              <div key={k} className="flex justify-between py-1 text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="font-medium">{v}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => onComplete(finalConnection)}
            className="w-full rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >Færdig</button>
        </div>
      )}
    </div>
  );
}
