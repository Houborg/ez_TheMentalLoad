'use client';

import { useState, useEffect, useMemo } from 'react';
import { RefreshCw, MessageSquare, Calendar, Newspaper, User, BookOpen, GraduationCap, UserCheck, Trash2 } from 'lucide-react';
import type { Member } from '@mental-load/contracts';
import { aulaDeleteItem, aulaGetItems, aulaGetConnection, type AulaItem, type AulaConnectionPublic } from '@/lib/aula-api';
import { cleanAulaHtml, looksLikeHtml } from '@/lib/aula-html';
import { cn } from '@/lib/utils';

type ItemType = 'post' | 'message' | 'daily_overview' | 'weekplan_lesson' | 'mu_task' | 'presence';

const TYPE_LABELS: Record<ItemType, string> = {
  post: 'Opslag',
  message: 'Beskeder',
  daily_overview: 'Dagsoverblik',
  weekplan_lesson: 'Ugeplan',
  mu_task: 'Lektier',
  presence: 'Tilstedeværelse',
};

const TYPE_ICONS: Record<ItemType, React.ReactNode> = {
  post: <Newspaper className="h-3.5 w-3.5" />,
  message: <MessageSquare className="h-3.5 w-3.5" />,
  daily_overview: <Calendar className="h-3.5 w-3.5" />,
  weekplan_lesson: <BookOpen className="h-3.5 w-3.5" />,
  mu_task: <GraduationCap className="h-3.5 w-3.5" />,
  presence: <UserCheck className="h-3.5 w-3.5" />,
};

function formatDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function ItemCard({
  item,
  memberName,
  onDelete,
}: {
  item: AulaItem;
  memberName?: string;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const body = item.body ?? '';
  const isHtml = looksLikeHtml(body);
  const cleanedHtml = useMemo(() => (isHtml ? cleanAulaHtml(body) : ''), [body, isHtml]);
  const showToggle = body.length > 120;
  const canDelete = !!onDelete && item.type === 'message';

  // Auto-dismiss the confirm pill after 3s
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  async function handleDeleteConfirmed() {
    if (!onDelete) return;
    setDeleting(true);
    try {
      await onDelete(item.id);
    } finally {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          {TYPE_ICONS[item.type as ItemType]}
          <span>{item.title || body.slice(0, 60) || '(ingen titel)'}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {confirming ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Slet besked?</span>
              <button
                type="button"
                onClick={handleDeleteConfirmed}
                disabled={deleting}
                className="rounded-md bg-rose-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
              >Ja, slet</button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent"
              >Annullér</button>
            </div>
          ) : (
            <>
              <span className="text-xs text-muted-foreground">{formatDate(item.published_at)}</span>
              {canDelete && (
                <button
                  type="button"
                  aria-label="Slet besked"
                  onClick={() => setConfirming(true)}
                  className="rounded-md p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {item.author && (
        <p className="text-xs text-muted-foreground">Fra: {item.author}</p>
      )}
      {memberName && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <User className="h-3 w-3" /> {memberName}
        </p>
      )}
      {body && (
        <>
          {isHtml ? (
            <div
              className={cn(
                'text-xs text-foreground/80 aula-prose',
                !expanded && 'line-clamp-3',
              )}
              dangerouslySetInnerHTML={{ __html: cleanedHtml }}
            />
          ) : (
            <p className={cn('text-xs text-foreground/80 whitespace-pre-wrap', !expanded && 'line-clamp-2')}>
              {body}
            </p>
          )}
          {showToggle && (
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-primary"
            >
              {expanded ? 'Vis mindre' : 'Vis mere'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

type Props = { members: Member[] };

export function AulaDataViewer({ members }: Props) {
  const [connection, setConnection] = useState<AulaConnectionPublic | null>(null);
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeType, setActiveType] = useState<ItemType | 'all'>('all');
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(id: string) {
    const prev = items;
    setItems(items.filter(i => i.id !== id));
    try {
      await aulaDeleteItem(id);
    } catch {
      setError('Kunne ikke slette beskeden. Prøv igen.');
      setItems(prev);
      setTimeout(() => setError(null), 4000);
    }
  }

  async function load() {
    setLoading(true);
    try {
      const [connRes, itemsRes] = await Promise.all([
        aulaGetConnection(),
        aulaGetItems({ pageSize: 100 }),
      ]);
      setConnection(connRes.connection);
      setItems(itemsRes.items);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (!connection) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Aula er ikke tilknyttet endnu. Gå til Aula-fanen for at tilknytte.
      </div>
    );
  }

  const filtered = activeType === 'all' ? items : items.filter(i => i.type === activeType);

  // Group by member
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
  const byMember: Record<string, AulaItem[]> = {};
  const noMember: AulaItem[] = [];
  for (const item of filtered) {
    if (item.member_id) {
      byMember[item.member_id] = [...(byMember[item.member_id] ?? []), item];
    } else {
      noMember.push(item);
    }
  }

  const types: Array<ItemType | 'all'> = ['all', 'weekplan_lesson', 'mu_task', 'message', 'post', 'presence', 'daily_overview'];
  const counts: Record<string, number> = {
    all: items.length,
    post: items.filter(i => i.type === 'post').length,
    message: items.filter(i => i.type === 'message').length,
    daily_overview: items.filter(i => i.type === 'daily_overview').length,
    weekplan_lesson: items.filter(i => i.type === 'weekplan_lesson').length,
    mu_task: items.filter(i => i.type === 'mu_task').length,
    presence: items.filter(i => i.type === 'presence').length,
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Tilknyttet som {connection.aulaUsername}</p>
          {connection.lastSyncAt && (
            <p className="text-xs text-muted-foreground">
              Sidst synkroniseret: {formatDate(connection.lastSyncAt)}
              {connection.lastSyncStats && (
                <> · {connection.lastSyncStats.entriesCreated} begivenheder · {connection.lastSyncStats.itemsCreated} opslag</>
              )}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          Opdater
        </button>
      </div>

      {/* Type filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {types.map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveType(t)}
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
              activeType === t
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            )}
          >
            {t === 'all' ? 'Alle' : TYPE_LABELS[t]} ({counts[t]})
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-8 text-center text-sm text-muted-foreground">Henter data...</div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">
          Ingen data endnu — prøv at synkronisere manuelt fra Aula-fanen.
        </div>
      ) : (
        <div className="space-y-6">
          {/* Items grouped by member */}
          {Object.entries(byMember).map(([memberId, memberItems]) => (
            <div key={memberId}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                <User className="h-3.5 w-3.5" />
                {memberMap[memberId] ?? memberId}
                <span className="font-normal">({memberItems.length})</span>
              </h3>
              <div className="space-y-2">
                {memberItems.map(item => (
                  <ItemCard key={item.id} item={item} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          ))}

          {/* Items without a member (posts, messages) */}
          {noMember.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Generelt ({noMember.length})
              </h3>
              <div className="space-y-2">
                {noMember.map(item => (
                  <ItemCard key={item.id} item={item} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
