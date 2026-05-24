'use client';

import { Clock } from 'lucide-react';
import type { AulaItem } from '@/lib/aula-api';
import { BottomSheet } from '@/components/mobile/bottom-sheet';
import { cleanAulaHtml, looksLikeHtml } from '@/lib/aula-html';

interface Props {
  item: AulaItem | null;
  onClose: () => void;
}

export function LessonDetailSheet({ item, onClose }: Props) {
  if (!item) return null;
  const raw = item.raw_json as { startTime?: string; endTime?: string; source?: string } | undefined;
  const startTime = raw?.startTime;
  const endTime = raw?.endTime;
  const source = raw?.source;
  const body = item.body ?? '';
  const isHtml = looksLikeHtml(body);

  return (
    <BottomSheet open={!!item} onClose={onClose} ariaLabelledby="lesson-detail-title">
      <div className="space-y-3 p-4">
        <h2 id="lesson-detail-title" className="text-lg font-semibold">
          {item.title || 'Lektion'}
        </h2>
        {(startTime || endTime) && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>{startTime ?? '?'} – {endTime ?? '?'}</span>
            {source && (
              <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">
                {source}
              </span>
            )}
          </div>
        )}
        {body ? (
          isHtml ? (
            <div
              className="aula-prose text-sm text-foreground/85"
              dangerouslySetInnerHTML={{ __html: cleanAulaHtml(body) }}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-foreground/85">{body}</p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">Ingen yderligere beskrivelse.</p>
        )}
      </div>
    </BottomSheet>
  );
}
