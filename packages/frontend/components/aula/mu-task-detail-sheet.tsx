'use client';

import { ExternalLink, GraduationCap } from 'lucide-react';
import type { AulaItem } from '@/lib/aula-api';
import { BottomSheet } from '@/components/mobile/bottom-sheet';
import { cleanAulaHtml, looksLikeHtml } from '@/lib/aula-html';

interface Props {
  task: AulaItem | null;
  onClose: () => void;
}

export function MuTaskDetailSheet({ task, onClose }: Props) {
  if (!task) return null;
  const raw = task.raw_json as { subject?: string; url?: string; status?: string } | undefined;
  const body = task.body ?? '';
  const isHtml = looksLikeHtml(body);

  return (
    <BottomSheet open={!!task} onClose={onClose} ariaLabelledby="mu-task-detail-title">
      <div className="space-y-3 p-4">
        <h2 id="mu-task-detail-title" className="text-lg font-semibold">
          {task.title || 'Lektie'}
        </h2>
        <div className="flex items-center gap-2 text-sm">
          <GraduationCap className="h-4 w-4 text-muted-foreground" />
          {raw?.subject && <span className="font-medium">{raw.subject}</span>}
          {task.published_at && (
            <span className="text-muted-foreground">
              · forfald {new Date(task.published_at).toLocaleDateString('da-DK')}
            </span>
          )}
        </div>
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
          <p className="text-sm text-muted-foreground">Ingen beskrivelse.</p>
        )}
        {raw?.url && (
          <a
            href={raw.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-4 w-4" /> Åbn i Aula
          </a>
        )}
      </div>
    </BottomSheet>
  );
}
