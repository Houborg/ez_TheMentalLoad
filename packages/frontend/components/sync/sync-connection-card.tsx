'use client';

import { useState } from 'react';
import type { SyncConnection } from '@mental-load/contracts';
import { updateSyncConnection, deleteSyncConnection, runSyncConnection } from '../../lib/api-sync-connections';

interface SyncConnectionCardProps {
  connection: SyncConnection;
  onReconfigure: () => void;
  onDeleted: () => void;
  onUpdated: (conn: SyncConnection) => void;
}

export function SyncConnectionCard({ connection, onReconfigure, onDeleted, onUpdated }: SyncConnectionCardProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(String(connection.syncIntervalMinutes));
  const [caldavUrl, setCaldavUrl] = useState(connection.caldavUrl ?? 'https://caldav.icloud.com');
  const [calendarPath, setCalendarPath] = useState(connection.calendarPath ?? '');

  async function handleSyncNow() {
    setBusy(true);
    setMessage('');
    try {
      const result = await runSyncConnection(connection.id);
      setMessage(result.message);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveAdvanced() {
    setBusy(true);
    try {
      const updated = await updateSyncConnection(connection.id, {
        syncIntervalMinutes: Number(intervalMinutes),
        caldavUrl,
        calendarPath,
      });
      onUpdated(updated);
      setMessage('Settings saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Apple Calendar? Already-imported events will remain in MentalLoad.')) return;
    await deleteSyncConnection(connection.id);
    onDeleted();
  }

  const directionLabel =
    connection.importEnabled && connection.exportEnabled ? 'Bidirectional' :
    connection.importEnabled ? 'Import only' : 'Export only';

  return (
    <div className="flex flex-col gap-4">
      {/* Status header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{connection.provider === 'apple' ? '🍎' : 'G'}</span>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{connection.calendarName ?? connection.provider}</span>
            <span className="rounded-md bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-600 dark:text-green-400">Connected</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {connection.lastSyncAt
              ? `Last sync ${new Date(connection.lastSyncAt).toLocaleTimeString()} · `
              : 'Never synced · '}
            {directionLabel}
          </p>
        </div>
      </div>

      {message && <p className="rounded-xl bg-primary/10 px-3 py-2 text-sm text-primary">{message}</p>}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void handleSyncNow()}
          disabled={busy}
          className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60 disabled:opacity-40"
        >
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
        <button
          onClick={onReconfigure}
          className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60"
        >
          Reconfigure
        </button>
      </div>

      {/* Advanced settings toggle */}
      <button
        onClick={() => setAdvancedOpen(!advancedOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <span>{advancedOpen ? '▾' : '▸'}</span> Advanced settings
      </button>

      {advancedOpen && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/60 bg-muted/20 p-4">
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">CalDAV server URL</span>
            <input
              value={caldavUrl}
              onChange={(e) => setCaldavUrl(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Apple ID (read-only)</span>
            <input
              value={connection.appleId ?? ''}
              readOnly
              className="rounded-xl border border-border/60 bg-muted/40 px-3 py-2 text-sm opacity-60 outline-none"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Calendar path</span>
            <input
              value={calendarPath}
              onChange={(e) => setCalendarPath(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm font-mono outline-none focus:border-primary/60"
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Auto-sync interval</span>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(e.target.value)}
              className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
            >
              <option value="15">Every 15 minutes</option>
              <option value="30">Every 30 minutes</option>
              <option value="60">Every hour</option>
              <option value="99999">Manual only</option>
            </select>
          </label>
          {connection.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Last sync: {new Date(connection.lastSyncAt).toLocaleString()} · {connection.lastImportCount ?? 0} imported
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => void handleSaveAdvanced()}
              disabled={busy}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40"
            >Save</button>
            <button
              onClick={() => void handleDisconnect()}
              className="rounded-xl border border-destructive/60 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
            >Disconnect</button>
          </div>
        </div>
      )}
    </div>
  );
}
