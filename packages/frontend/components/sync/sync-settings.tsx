'use client';

import { useEffect, useState } from 'react';
import type { SyncConnection } from '@mental-load/contracts';
import { listSyncConnections } from '../../lib/api-sync-connections';
import { AppleWizard } from './apple-wizard';
import { SyncConnectionCard } from './sync-connection-card';

type PanelState =
  | { mode: 'card'; connection: SyncConnection }
  | { mode: 'wizard'; provider: 'apple'; existingConnectionId?: string }
  | { mode: 'empty' };

export function SyncSettings() {
  const [connections, setConnections] = useState<SyncConnection[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState>({ mode: 'empty' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listSyncConnections()
      .then((list) => {
        setConnections(list);
        if (list.length > 0) {
          setSelected(list[0].id);
          setPanel({ mode: 'card', connection: list[0] });
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  function selectConnection(conn: SyncConnection) {
    setSelected(conn.id);
    setPanel({ mode: 'card', connection: conn });
  }

  function startWizard(provider: 'apple') {
    setSelected(null);
    setPanel({ mode: 'wizard', provider });
  }

  function handleWizardComplete(conn: SyncConnection) {
    const next = [...connections.filter((c) => c.id !== conn.id), conn];
    setConnections(next);
    setSelected(conn.id);
    setPanel({ mode: 'card', connection: conn });
  }

  function handleDeleted() {
    const next = connections.filter((c) => c.id !== selected);
    setConnections(next);
    setSelected(next[0]?.id ?? null);
    setPanel(next[0] ? { mode: 'card', connection: next[0] } : { mode: 'empty' });
  }

  function handleUpdated(conn: SyncConnection) {
    const next = connections.map((c) => c.id === conn.id ? conn : c);
    setConnections(next);
    setPanel({ mode: 'card', connection: conn });
  }

  const hasApple = connections.some((c) => c.provider === 'apple');

  if (loading) return <div className="text-sm text-muted-foreground">Loading sync settings…</div>;

  return (
    <div className="flex min-h-[240px] gap-0 rounded-2xl border border-border/60 overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="flex w-36 shrink-0 flex-col gap-1 border-r border-border/60 p-3">
        {connections.map((conn) => (
          <button
            key={conn.id}
            onClick={() => selectConnection(conn)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors
              ${selected === conn.id ? 'bg-primary/10 text-primary font-semibold' : 'text-muted-foreground hover:bg-accent/40'}`}
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${conn.isConnected ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
            <span className="truncate">{conn.provider === 'apple' ? '🍎 Apple' : conn.provider}</span>
          </button>
        ))}

        {/* Google placeholder — coming soon */}
        <button
          disabled
          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground/40 cursor-not-allowed"
          title="Coming soon"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20" />
          <span className="truncate">G Google</span>
        </button>

        <div className="mt-auto pt-2">
          {!hasApple && (
            <button
              onClick={() => startWizard('apple')}
              className="flex w-full items-center gap-1 rounded-lg px-2.5 py-2 text-xs text-primary hover:bg-primary/10"
            >+ Add</button>
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      <div className="flex-1 p-5">
        {panel.mode === 'empty' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-muted-foreground">No calendar connected yet.</p>
            <button
              onClick={() => startWizard('apple')}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            >Connect Apple Calendar</button>
          </div>
        )}

        {panel.mode === 'card' && (
          <SyncConnectionCard
            connection={panel.connection}
            onReconfigure={() => {
              if (panel.mode === 'card') {
                setPanel({ mode: 'wizard', provider: panel.connection.provider as 'apple', existingConnectionId: panel.connection.id });
              }
            }}
            onDeleted={handleDeleted}
            onUpdated={handleUpdated}
          />
        )}

        {panel.mode === 'wizard' && (
          <AppleWizard
            onComplete={handleWizardComplete}
            existingConnectionId={panel.existingConnectionId}
            onCancel={() => {
              const conn = connections.find((c) => c.id === selected);
              setPanel(conn ? { mode: 'card', connection: conn } : { mode: 'empty' });
            }}
          />
        )}
      </div>
    </div>
  );
}
