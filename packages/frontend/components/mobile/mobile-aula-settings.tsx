// packages/frontend/components/mobile/mobile-aula-settings.tsx
'use client';

import { useState, useEffect } from 'react';
import { Loader2, CheckCircle, AlertCircle, RefreshCw, Unlink } from 'lucide-react';
import type { Member, Calendar } from '@mental-load/contracts';
import { cn } from '@/lib/utils';
import {
  aulaVerify, aulaConnect, aulaGetConnection, aulaDisconnect, aulaTriggerSync,
  type AulaChild, type AulaTokens, type AulaChildMapping, type AulaSyncOptions,
  type AulaConnectionPublic,
} from '@/lib/aula-api';

const INPUT = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block';

type Step = 1 | 2 | 3 | 4 | 5;

type Props = { members: Member[]; calendars: Calendar[] };

export function MobileAulaSettings({ members, calendars }: Props) {
  const [connection, setConnection] = useState<AulaConnectionPublic | null | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [verifiedTokens, setVerifiedTokens] = useState<AulaTokens | null>(null);
  const [aulaChildren, setAulaChildren] = useState<AulaChild[]>([]);

  const [mappings, setMappings] = useState<Record<number, { memberId: string; calendarId: string }>>({});

  const [syncOptions, setSyncOptions] = useState<AulaSyncOptions>({
    importToCalendar: false,
    calendarEvents: true,
    dailyOverview: false,
    posts: false,
    messages: false,
  });

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  useEffect(() => {
    aulaGetConnection()
      .then(r => setConnection(r.connection))
      .catch(() => setConnection(null));
  }, []);

  async function handleVerify() {
    setAuthError('');
    setAuthLoading(true);
    try {
      const { children, tokens } = await aulaVerify(username, password, code);
      setVerifiedTokens(tokens);
      setAulaChildren(children);
      setStep(3);
    } catch (err) {
      setAuthError((err as Error).message ?? 'Login fejlede');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleConnect() {
    if (!verifiedTokens) return;
    setConnecting(true);
    setConnectError('');
    try {
      const childMappings: AulaChildMapping[] = aulaChildren
        .filter(c => mappings[c.id]?.memberId)
        .map(c => ({
          aulaChildId: c.id,
          aulaChildName: c.name,
          mentalLoadMemberId: mappings[c.id].memberId,
          calendarId: mappings[c.id].calendarId || (calendars[0]?.id ?? ''),
        }));

      if (!childMappings.length) return;

      const { connection: conn } = await aulaConnect({
        tokens: verifiedTokens,
        aulaUsername: username,
        childMappings,
        syncOptions,
      });
      setConnection(conn);
      setStep(5);
    } catch (err) {
      setConnectError((err as Error).message ?? 'Tilknytning fejlede');
    } finally {
      setConnecting(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMsg('');
    try {
      const { stats } = await aulaTriggerSync();
      setSyncMsg(`Synkroniseret: +${stats.entriesCreated} begivenheder, +${stats.itemsCreated} opslag`);
      const { connection: conn } = await aulaGetConnection();
      setConnection(conn);
    } catch {
      setSyncMsg('Synkronisering fejlede');
    } finally {
      setSyncing(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      await aulaDisconnect();
      setConnection(null);
      setStep(1);
      setUsername(''); setPassword(''); setCode('');
      setVerifiedTokens(null);
      setAulaChildren([]);
      setMappings({});
    } finally {
      setDisconnecting(false);
    }
  }

  if (connection === undefined) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  if (connection) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium">Tilknyttet Aula</span>
          </div>
          <p className="text-xs text-muted-foreground">{connection.aulaUsername}</p>
          {connection.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Sidst synkroniseret: {new Date(connection.lastSyncAt).toLocaleString('da-DK')}
            </p>
          )}
          {connection.lastSyncStats && (
            <p className="text-xs text-muted-foreground">
              {connection.lastSyncStats.entriesCreated} begivenheder · {connection.lastSyncStats.itemsCreated} opslag
            </p>
          )}
          {syncMsg && <p className="text-xs text-primary">{syncMsg}</p>}
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 w-full justify-center rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Synkroniser nu
        </button>

        <button
          type="button"
          onClick={handleDisconnect}
          disabled={disconnecting}
          className="flex items-center gap-2 w-full justify-center rounded-xl border border-destructive text-destructive px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {disconnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
          Afbryd forbindelse
        </button>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="space-y-4 py-2">
        <div className="rounded-xl bg-muted/50 p-4 space-y-2">
          <p className="text-sm font-medium">Hvad hentes fra Aula?</p>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
            <li>Skemabegivenheder og arrangementer</li>
            <li>Opslag fra skolen</li>
            <li>Beskeder fra lærere</li>
            <li>Dagsoverblik og fremmøde</li>
          </ul>
        </div>
        <button
          type="button"
          onClick={() => setStep(2)}
          className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
        >
          Tilknyt Aula
        </button>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="space-y-4 py-2">
        <div>
          <label className={LABEL}>MitID brugernavn</label>
          <input className={INPUT} value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" />
        </div>
        <div>
          <label className={LABEL}>Adgangskode</label>
          <input className={INPUT} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
        </div>
        <div>
          <label className={LABEL}>6-cifret kode</label>
          <input
            className={INPUT}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            placeholder="000000"
          />
          <p className="text-xs text-muted-foreground mt-1">Åbn MitID-appen og find din 6-cifrede kode</p>
        </div>
        {authError && (
          <div className="flex items-center gap-2 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {authError}
          </div>
        )}
        <button
          type="button"
          onClick={handleVerify}
          disabled={authLoading || !username || !password || code.length < 6}
          className="flex items-center gap-2 w-full justify-center rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {authLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          {authLoading ? 'Logger ind...' : 'Log ind'}
        </button>
        <button type="button" onClick={() => setStep(1)} className="w-full text-xs text-muted-foreground py-1">
          Tilbage
        </button>
      </div>
    );
  }

  if (step === 3) {
    const hasMapping = aulaChildren.some(c => mappings[c.id]?.memberId);
    return (
      <div className="space-y-4 py-2">
        <p className="text-xs text-muted-foreground">Forbind hvert barn med et familiemedlem i MentalLoad.</p>
        {aulaChildren.map(child => (
          <div key={child.id} className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-sm font-medium">{child.name}</p>
            <p className="text-xs text-muted-foreground">{child.institutionName}</p>
            <select
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none"
              value={mappings[child.id]?.memberId ?? ''}
              onChange={e => setMappings(prev => ({
                ...prev,
                [child.id]: { memberId: e.target.value, calendarId: calendars.find(cal => cal.ownerMemberId === e.target.value)?.id ?? '' },
              }))}
            >
              <option value="">Spring over</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setStep(4)}
          disabled={!hasMapping}
          className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          Næste
        </button>
      </div>
    );
  }

  if (step === 4) {
    const toggles: Array<{ key: keyof AulaSyncOptions; label: string; description: string }> = [
      { key: 'calendarEvents', label: 'Kalenderbegivenheder', description: 'Skema og arrangementer' },
      { key: 'dailyOverview', label: 'Dagsoverblik', description: 'Fremmøde og tilstedeværelse' },
      { key: 'posts', label: 'Opslag', description: 'Nyheder og beskeder fra skolen' },
      { key: 'messages', label: 'Beskeder', description: 'Direkte beskeder fra lærere' },
      { key: 'importToCalendar', label: 'Importer til kalender', description: 'Skriv begivenheder direkte til MentalLoad' },
    ];
    return (
      <div className="space-y-3 py-2">
        <p className="text-xs text-muted-foreground">Vælg hvad der skal hentes fra Aula.</p>
        {toggles.map(({ key, label, description }) => (
          <button
            key={key}
            type="button"
            role="switch"
            aria-checked={syncOptions[key]}
            onClick={() => setSyncOptions(prev => ({ ...prev, [key]: !prev[key] }))}
            className="flex items-center justify-between w-full rounded-xl border border-border p-3 text-left"
          >
            <div>
              <p className={cn('text-sm font-medium', key === 'importToCalendar' && 'text-amber-600 dark:text-amber-400')}>{label}</p>
              <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <div className={cn('h-5 w-9 rounded-full transition-colors flex-shrink-0', syncOptions[key] ? 'bg-primary' : 'bg-muted')} />
          </button>
        ))}
        {connectError && (
          <div className="flex items-center gap-2 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
            {connectError}
          </div>
        )}
        <button
          type="button"
          onClick={handleConnect}
          disabled={connecting}
          className="flex items-center gap-2 w-full justify-center rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
          {connecting ? 'Gemmer...' : 'Gem og tilknyt'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4 py-2 text-center">
      <CheckCircle className="h-10 w-10 text-green-500 mx-auto" />
      <p className="text-sm font-medium">Aula er tilknyttet!</p>
      <p className="text-xs text-muted-foreground">Synkronisering starter om lidt.</p>
      <button
        type="button"
        onClick={() => aulaGetConnection().then(r => setConnection(r.connection)).catch(() => {})}
        className="w-full rounded-xl bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium"
      >
        Færdig
      </button>
    </div>
  );
}
