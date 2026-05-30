/** Shared constants imported by app.ts without triggering worker startup code. */

export const AI_QUEUE_NAME = 'mental-load-ai';

export interface AiJobData {
  familyId: string;
  triggerType: 'morning' | 'event' | 'sync' | 'manual';
  triggerRef?: string;
  triggerContext?: string;
}
