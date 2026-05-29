'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2, Plus, Check } from 'lucide-react';
import type { AppSettings, Calendar, Member, MemberRole } from '@mental-load/contracts';
import {
  loadSettings, saveSettings,
  createMember, updateMember, deleteMember,
  deleteCalendar,
  loadHealth, type WeatherForecastResponse,
  loadWeatherForecast,
} from '@/lib/api';
import { SettingsHolidays } from '@/components/settings-holidays';
import { SyncSettings } from '@/components/sync/sync-settings';
import { MobileAulaSettings } from './mobile-aula-settings';
import { cn } from '@/lib/utils';

type Tab = 'tema' | 'vejr' | 'familie' | 'kalendere' | 'assistent' | 'helligdage' | 'sync' | 'aula' | 'udvikler';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'tema', label: 'Tema' },
  { id: 'vejr', label: 'Vejr' },
  { id: 'familie', label: 'Familie' },
  { id: 'kalendere', label: 'Kalendere' },
  { id: 'assistent', label: 'Assistent' },
  { id: 'helligdage', label: 'Helligdage' },
  { id: 'sync', label: 'Sync' },
  { id: 'aula', label: 'Aula' },
  { id: 'udvikler', label: 'Udvikler' },
];

const INPUT = 'w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5';

type Props = {
  members: Member[];
  calendars: Calendar[];
  onRefresh: () => void;
};

export function MobileSettingsContent({ members, calendars, onRefresh }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('tema');
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    loadSettings().then(s => { setSettings(s); setLoadingSettings(false); }).catch(console.error);
  }, []);

  async function save(patch: Parameters<typeof saveSettings>[0]) {
    setSaving(true);
    setSaveMsg('');
    try {
      const updated = await saveSettings(patch);
      setSettings(updated);
      setSaveMsg('Gemt ✓');
      setTimeout(() => setSaveMsg(''), 2000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex gap-1.5 overflow-x-auto px-4 py-3 border-b border-border flex-shrink-0 scrollbar-none">
        {TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              activeTab === tab.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4 flex flex-col gap-5">
          {saveMsg && (
            <div className="flex items-center gap-2 text-xs text-green-600 dark:text-green-400">
              <Check className="h-3.5 w-3.5" /> {saveMsg}
            </div>
          )}
          {saving && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Gemmer…
            </div>
          )}

          {loadingSettings && activeTab !== 'familie' && activeTab !== 'kalendere' && activeTab !== 'helligdage' && activeTab !== 'sync' && activeTab !== 'aula' ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* ── TEMA ── */}
              {activeTab === 'tema' && settings && (
                <>
                  <div>
                    <p className={LABEL}>Farvetema</p>
                    <div className="flex rounded-xl border border-border overflow-hidden">
                      {(['system', 'light', 'dark'] as const).map(mode => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => save({ theme: { ...settings.theme, mode } })}
                          className={cn(
                            'flex-1 py-2.5 text-sm font-medium transition-colors',
                            settings.theme.mode === mode
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground',
                          )}
                        >
                          {mode === 'system' ? 'Auto' : mode === 'light' ? 'Lys' : 'Mørk'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={LABEL}>Sprog</p>
                    <div className="flex rounded-xl border border-border overflow-hidden">
                      {(['da', 'en'] as const).map(lang => (
                        <button
                          key={lang}
                          type="button"
                          onClick={() => save({ language: lang })}
                          className={cn(
                            'flex-1 py-2.5 text-sm font-medium transition-colors',
                            settings.language === lang
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground',
                          )}
                        >
                          {lang === 'da' ? 'Dansk' : 'English'}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {/* ── VEJR ── */}
              {activeTab === 'vejr' && settings && (
                <WeatherTab settings={settings} onSave={save} />
              )}

              {/* ── FAMILIE ── */}
              {activeTab === 'familie' && (
                <FamilyTab members={members} onRefresh={onRefresh} />
              )}

              {/* ── KALENDERE ── */}
              {activeTab === 'kalendere' && (
                <CalendarsTab calendars={calendars} onRefresh={onRefresh} />
              )}

              {/* ── ASSISTENT ── */}
              {activeTab === 'assistent' && settings && (
                <AssistantTab settings={settings} onChange={setSettings} onSave={save} />
              )}

              {/* ── HELLIGDAGE ── */}
              {activeTab === 'helligdage' && (
                <SettingsHolidays calendars={calendars} />
              )}

              {/* ── SYNC ── */}
              {activeTab === 'sync' && (
                <SyncSettings />
              )}

              {/* ── AULA ── */}
              {activeTab === 'aula' && (
                <MobileAulaSettings members={members} calendars={calendars} />
              )}


              {/* ── UDVIKLER ── */}
              {activeTab === 'udvikler' && (
                <DeveloperTab />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Weather ─── */
function WeatherTab({
  settings,
  onSave,
}: {
  settings: AppSettings;
  onSave: (patch: Parameters<typeof saveSettings>[0]) => Promise<void>;
}) {
  const w = settings.weather;
  const [location, setLocation] = useState(w.location ?? '');
  const [country, setCountry] = useState(w.country ?? '');
  const [unit, setUnit] = useState<'C' | 'F'>(w.unit ?? 'C');
  const [testing, setTesting] = useState(false);
  const [forecast, setForecast] = useState<WeatherForecastResponse | null>(null);
  const [error, setError] = useState('');

  async function handleSave() {
    await onSave({ weather: { location, country, unit } });
  }

  async function handleTest() {
    if (!location) return;
    setTesting(true);
    setError('');
    setForecast(null);
    try {
      const result = await loadWeatherForecast({ location, country, unit, days: 1 });
      setForecast(result);
    } catch {
      setError('Kunne ikke hente vejr for den placering.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className={LABEL}>By / placering</p>
        <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Eks: Copenhagen" className={INPUT} />
      </div>
      <div>
        <p className={LABEL}>Land</p>
        <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Eks: DK" className={INPUT} />
      </div>
      <div>
        <p className={LABEL}>Enhed</p>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['C', 'F'] as const).map(u => (
            <button key={u} type="button" onClick={() => setUnit(u)}
              className={cn('flex-1 py-2.5 text-sm font-medium', unit === u ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground')}>
              °{u}
            </button>
          ))}
        </div>
      </div>
      {forecast && (
        <p className="text-xs text-green-600 dark:text-green-400">
          ✓ Fundet: {forecast.resolvedLocation.name}, {forecast.resolvedLocation.country}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={handleTest} disabled={!location || testing}
          className="rounded-xl border border-border px-4 py-2.5 text-sm text-muted-foreground disabled:opacity-50">
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
        </button>
        <button type="button" onClick={handleSave}
          className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
          Gem
        </button>
      </div>
    </div>
  );
}

/* ─── Family ─── */
function FamilyTab({ members, onRefresh }: { members: Member[]; onRefresh: () => void }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('parent');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      await createMember({ name: newName.trim(), role: newRole, email: newEmail.trim() || undefined });
      setNewName(''); setNewEmail(''); setAdding(false);
      onRefresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try { await deleteMember(id); onRefresh(); } finally { setDeletingId(null); }
  }

  return (
    <div className="flex flex-col gap-3">
      {members.map(m => (
        <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold flex-shrink-0">
            {m.avatar || m.name[0]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{m.name}</div>
            <div className="text-xs text-muted-foreground">{m.role === 'parent' ? 'Forælder' : 'Barn'}{m.email ? ` · ${m.email}` : ''}</div>
          </div>
          <button type="button" onClick={() => handleDelete(m.id)} disabled={deletingId === m.id}
            className="text-destructive opacity-60 hover:opacity-100 disabled:opacity-30">
            {deletingId === m.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      ))}

      {adding ? (
        <div className="rounded-xl border border-border/60 p-3 flex flex-col gap-2">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Navn *" className={INPUT} />
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email (valgfri)" className={INPUT} type="email" />
          <div className="flex rounded-xl border border-border overflow-hidden">
            {(['parent', 'child'] as const).map(r => (
              <button key={r} type="button" onClick={() => setNewRole(r)}
                className={cn('flex-1 py-2 text-sm font-medium', newRole === r ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground')}>
                {r === 'parent' ? 'Forælder' : 'Barn'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setAdding(false)} className="flex-1 rounded-xl border border-border py-2 text-sm text-muted-foreground">Annuller</button>
            <button type="button" onClick={handleAdd} disabled={!newName.trim() || saving}
              className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : 'Tilføj'}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)}
          className="flex items-center gap-2 text-sm text-primary py-1">
          <Plus className="h-4 w-4" /> Tilføj familiemedlem
        </button>
      )}
    </div>
  );
}

/* ─── Calendars ─── */
function CalendarsTab({ calendars, onRefresh }: { calendars: Calendar[]; onRefresh: () => void }) {
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try { await deleteCalendar(id); onRefresh(); } finally { setDeletingId(null); }
  }

  return (
    <div className="flex flex-col gap-2">
      {calendars.map(cal => (
        <div key={cal.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2.5">
          <span className="h-3.5 w-3.5 rounded-full flex-shrink-0" style={{ background: cal.color }} />
          <span className="flex-1 text-sm">{cal.name}</span>
          <button type="button" onClick={() => handleDelete(cal.id)} disabled={deletingId === cal.id}
            className="text-destructive opacity-60 hover:opacity-100 disabled:opacity-30">
            {deletingId === cal.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        </div>
      ))}
      {calendars.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">Ingen kalendere endnu.</p>}
    </div>
  );
}

/* ─── Assistant ─── */
const AI_PROVIDERS = [
  { value: 'claude', label: 'Claude (Anthropic)', hint: 'claude-haiku-4-5' },
  { value: 'openai', label: 'OpenAI (GPT)', hint: 'gpt-4o-mini' },
  { value: 'ollama', label: 'Ollama (lokal/fjern)', hint: 'llama3.2' },
  { value: 'none',   label: 'Ingen AI', hint: 'Regelbaseret kun' },
] as const;

function AssistantTab({
  settings,
  onChange,
  onSave,
}: {
  settings: AppSettings;
  onChange: (s: AppSettings) => void;
  onSave: (patch: Parameters<typeof saveSettings>[0]) => Promise<void>;
}) {
  const a = settings.assistant;
  const provider = a.provider ?? 'claude';

  function patch(update: Partial<AppSettings['assistant']>) {
    onChange({ ...settings, assistant: { ...a, ...update } });
  }

  function handleSave() {
    return onSave({
      assistant: {
        provider: a.provider,
        apiKey: a.apiKey,
        openaiApiKey: a.openaiApiKey,
        openaiModel: a.openaiModel,
        ollamaUrl: a.ollamaUrl,
        ollamaModel: a.ollamaModel,
        tone: a.tone,
        customInstructions: a.customInstructions,
      },
    });
  }

  return (
    <div className="flex flex-col gap-5">

      {/* Provider selector */}
      <div>
        <p className={LABEL}>AI-udbyder</p>
        <div className="grid grid-cols-2 gap-2">
          {AI_PROVIDERS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => patch({ provider: p.value })}
              className={cn(
                'flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-colors',
                provider === p.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/50',
              )}
            >
              <span className="text-sm font-semibold">{p.label}</span>
              <span className="text-[10px] opacity-70">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Claude — API key */}
      {provider === 'claude' && (
        <div>
          <p className={LABEL}>Anthropic API-nøgle</p>
          <input
            type="password"
            value={a.apiKey ?? ''}
            onChange={e => patch({ apiKey: e.target.value })}
            placeholder="sk-ant-api03-…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary font-mono"
          />
          <p className="text-xs text-muted-foreground mt-1">Hentes fra <span className="font-mono">console.anthropic.com</span>. Gemmes krypteret i databasen.</p>
        </div>
      )}

      {/* OpenAI — API key + model */}
      {provider === 'openai' && (
        <>
          <div>
            <p className={LABEL}>OpenAI API-nøgle</p>
            <input
              type="password"
              value={a.openaiApiKey ?? ''}
              onChange={e => patch({ openaiApiKey: e.target.value })}
              placeholder="sk-…"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary font-mono"
            />
          </div>
          <div>
            <p className={LABEL}>Model</p>
            <div className="flex gap-2 flex-wrap">
              {['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'].map(m => (
                <button key={m} type="button"
                  onClick={() => patch({ openaiModel: m })}
                  className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                    (a.openaiModel ?? 'gpt-4o-mini') === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50')}>
                  {m}
                </button>
              ))}
              <input
                value={!['gpt-4o-mini','gpt-4o','gpt-4-turbo'].includes(a.openaiModel ?? '') ? (a.openaiModel ?? '') : ''}
                onChange={e => patch({ openaiModel: e.target.value })}
                placeholder="Anden model…"
                className="flex-1 min-w-[120px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
        </>
      )}

      {/* Ollama — URL + model */}
      {provider === 'ollama' && (
        <>
          <div>
            <p className={LABEL}>Ollama URL</p>
            <input
              type="url"
              value={a.ollamaUrl ?? ''}
              onChange={e => patch({ ollamaUrl: e.target.value })}
              placeholder="http://192.168.1.50:11434"
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary font-mono"
            />
            <p className="text-xs text-muted-foreground mt-1">IP/hostname på maskinen der kører Ollama.</p>
          </div>
          <div>
            <p className={LABEL}>Model</p>
            <div className="flex gap-2 flex-wrap">
              {['llama3.2:3b', 'llama3.2', 'mistral', 'gemma2:2b'].map(m => (
                <button key={m} type="button"
                  onClick={() => patch({ ollamaModel: m })}
                  className={cn('rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors',
                    (a.ollamaModel ?? 'llama3.2:3b') === m ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50')}>
                  {m}
                </button>
              ))}
              <input
                value={!['llama3.2:3b','llama3.2','mistral','gemma2:2b'].includes(a.ollamaModel ?? '') ? (a.ollamaModel ?? '') : ''}
                onChange={e => patch({ ollamaModel: e.target.value })}
                placeholder="Anden model…"
                className="flex-1 min-w-[120px] rounded-lg border border-border bg-background px-3 py-1.5 text-xs outline-none focus:border-primary"
              />
            </div>
          </div>
        </>
      )}

      {/* Tone */}
      <div>
        <p className={LABEL}>Tone</p>
        <div className="flex rounded-xl border border-border overflow-hidden">
          {(['informal', 'formal'] as const).map(t => (
            <button key={t} type="button" onClick={() => patch({ tone: t })}
              className={cn('flex-1 py-2.5 text-sm font-medium', (a.tone ?? 'informal') === t ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground')}>
              {t === 'informal' ? 'Uformel' : 'Formel'}
            </button>
          ))}
        </div>
      </div>

      {/* Custom instructions */}
      <div>
        <p className={LABEL}>Egne instruktioner</p>
        <textarea
          rows={3}
          value={a.customInstructions ?? ''}
          onChange={e => patch({ customInstructions: e.target.value })}
          placeholder="Eks: Brug altid navne. Vær humoristisk."
          className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary resize-none"
        />
        <p className="text-xs text-muted-foreground mt-1">Tilføjes til AI-assistentens systemprompt.</p>
      </div>

      <button type="button" onClick={handleSave}
        className="rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground">
        Gem
      </button>
    </div>
  );
}

/* ─── Developer ─── */
function DeveloperTab() {
  const [health, setHealth] = useState<{ version?: string; commit?: string; deployedAt?: string | null } | null>(null);
  const [updateState, setUpdateState] = useState<'idle' | 'updating' | 'done' | 'error'>('idle');
  const [updateMessage, setUpdateMessage] = useState('');

  useEffect(() => {
    loadHealth().then(h => setHealth({ version: h.version, commit: h.commit, deployedAt: h.deployedAt })).catch(console.error);
  }, []);

  async function handleUpdate() {
    setUpdateState('updating');
    setUpdateMessage('');
    try {
      const res = await fetch('/api/update', { method: 'POST' });
      const data = await res.json() as { ok?: boolean; message?: string };
      if (!res.ok) {
        setUpdateState('error');
        setUpdateMessage(data.message ?? `Error ${res.status}`);
      } else {
        setUpdateState('done');
        setUpdateMessage(data.message ?? 'Update triggered — app will restart in ~3–5 min.');
      }
    } catch (err) {
      setUpdateState('error');
      setUpdateMessage(err instanceof Error ? err.message : 'Could not reach server');
    }
  }

  const frontendCommit = process.env.NEXT_PUBLIC_APP_COMMIT ?? 'local';
  const frontendVersion = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0';

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Frontend build</div>
        <div className="text-sm font-mono">{frontendVersion} ({frontendCommit})</div>
      </div>
      <div className="rounded-xl border border-border/60 bg-card/60 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Server</div>
        {health ? (
          <div className="text-sm font-mono">{health.version ?? '—'} ({health.commit ?? '—'})</div>
        ) : (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      <button
        type="button"
        onClick={() => void handleUpdate()}
        disabled={updateState === 'updating'}
        className="rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60 flex items-center justify-center gap-2"
      >
        {updateState === 'updating' && <Loader2 className="h-4 w-4 animate-spin" />}
        {updateState === 'updating' ? 'Opdaterer…' : 'Opdater app'}
      </button>
      {updateMessage && (
        <p className={`text-xs px-1 ${updateState === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
          {updateMessage}
        </p>
      )}
    </div>
  );
}
