'use client';

import { useEffect, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { aulaGetItems, type AulaItem } from '@/lib/aula-api';
import { htmlExcerpt } from '@/lib/aula-html';

interface Props {
  memberId: string;
  memberName: string;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
}

function ExpandableMessage({ item }: { item: AulaItem }) {
  const [expanded, setExpanded] = useState(false);
  const body = item.body ?? '';
  const hasLongBody = body.length > 120;
  const raw = item.raw_json as { threadId?: number } | undefined;

  return (
    <div className="rounded-xl border border-border/60 bg-card/50 px-3 py-2.5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="text-xs font-semibold">{item.author ?? 'Ukendt'}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{formatDate(item.published_at)}</span>
      </div>
      {item.title && (
        <div className="text-sm font-medium mb-1">{item.title}</div>
      )}
      <p className={`text-xs text-muted-foreground leading-relaxed ${expanded ? '' : 'line-clamp-2'}`}>
        {htmlExcerpt(body, expanded ? 9999 : 150)}
      </p>
      {hasLongBody && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-[11px] font-semibold text-primary hover:underline"
        >
          {expanded ? 'Læs mindre' : 'Læs mere…'}
        </button>
      )}
      {raw?.threadId && (
        <div className="mt-1 text-[10px] text-muted-foreground">
          Tråd #{raw.threadId}
        </div>
      )}
    </div>
  );
}

export function MemberMessages({ memberId, memberName }: Props) {
  const [items, setItems] = useState<AulaItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    // Messages are family-wide (memberId=null in sync), so we fetch all
    aulaGetItems({ type: 'message', pageSize: 20 })
      .then(res => { if (active) setItems(res.items); })
      .catch(() => { if (active) setItems([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId]);

  return (
    <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Beskeder</h2>
        </div>
        <span className="rounded-full border border-border/60 px-2.5 py-1 text-xs text-muted-foreground">
          {items.length} beskeder
        </span>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Henter beskeder…</p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
          Ingen beskeder
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {items.map(msg => (
            <ExpandableMessage key={msg.id} item={msg} />
          ))}
        </div>
      )}
    </section>
  );
}
