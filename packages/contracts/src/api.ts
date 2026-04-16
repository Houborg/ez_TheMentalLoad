import type { AppSettings, AssistantDraft, Calendar, Entry, Member, MemberRole, SupportedLanguage, SyncProvider } from './domain';

export interface ApiHealth {
  status: 'ok';
  service: string;
  persistence?: 'memory' | 'postgres';
  now: string;
}

export interface DashboardSnapshot {
  members: Member[];
  calendars: Calendar[];
  entries: Entry[];
  reminderJobs?: Array<{ id: string; runAt: string }>;
  persistence?: 'memory' | 'postgres';
}

export interface AssistantParseRequest {
  message: string;
  memberId: string;
  calendarId: string;
  language?: SupportedLanguage;
  existingDraft?: AssistantDraft;
}

export interface AssistantParseResponse {
  source: 'rule-based' | 'ollama-fallback';
  response: string;
  requiresConfirmation: boolean;
  missingFields: string[];
  draft: AssistantDraft;
}

export interface AssistantConfirmRequest {
  draft: AssistantDraft;
}

export interface AssistantFunRequest {
  message: string;
  language?: SupportedLanguage;
}

export interface AssistantFunResponse {
  source: 'rule-based' | 'ollama-fallback';
  response: string;
}

export interface CreateMemberRequest {
  name: string;
  role: MemberRole;
}

export type UpdateSettingsRequest = Partial<AppSettings>;

export interface TestEmailRequest {
  to?: string;
}

export interface MailActionResponse {
  ok: boolean;
  preview: boolean;
  transport: 'log' | 'smtp';
  message: string;
}

export interface SyncConnectRequest {
  provider: SyncProvider;
  configJson: Record<string, unknown>;
}

export interface SyncConnectResponse {
  ok: boolean;
  isConnected: boolean;
  provider: SyncProvider;
  message: string;
}

export interface SyncRunRequest {
  provider?: SyncProvider;
  calendarId: string;
  ownerMemberId: string;
  rawContent?: string;
  icsUrl?: string;
}

export interface SyncRunResponse {
  ok: boolean;
  provider: SyncProvider;
  importedCount: number;
  lastSyncAt: string;
  message: string;
}

export type CreateEntryRequest = Pick<
  Entry,
  | 'title'
  | 'type'
  | 'ownerMemberId'
  | 'calendarId'
  | 'startTime'
  | 'endTime'
  | 'timezone'
  | 'allDay'
  | 'location'
  | 'recurrenceRule'
> & {
  reminders?: Array<{ minutesBefore: number }>;
};

export type UpdateEntryRequest = Partial<CreateEntryRequest> & {
  status?: Entry['status'];
};
