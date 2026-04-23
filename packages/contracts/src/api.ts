import type {
  AppSettings,
  AssistantDraft,
  Calendar,
  DailyTimelineTemplateTask,
  Entry,
  FoodPlanDay,
  FoodPlanItem,
  Member,
  MemberTimelineSettings,
  MemberRole,
  SupportedLanguage,
  SyncProvider,
  TodayMemberTimeline,
} from './domain';

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

export interface AssistantStatusResponse {
  ok: boolean;
  enabled: boolean;
  reachable: boolean;
  modelAvailable: boolean;
  provider: 'ollama' | 'rule-based';
  ollamaUrl?: string;
  modelName?: string;
  message: string;
}

export interface CreateMemberRequest {
  name: string;
  role: MemberRole;
  email?: string;
  avatar?: string;
}

export interface UpdateMemberRequest {
  name?: string;
  role?: MemberRole;
  email?: string;
  avatar?: string;
}

export interface UpdateSettingsRequest {
  id?: string;
  theme?: Partial<AppSettings['theme']>;
  assistant?: Partial<AppSettings['assistant']>;
  mail?: Partial<AppSettings['mail']>;
  sync?: Partial<AppSettings['sync']> & {
    configJson?: Record<string, unknown>;
  };
  updatedAt?: string;
}

export interface TestEmailRequest {
  to?: string;
}

export interface MailActionResponse {
  ok: boolean;
  preview: boolean;
  transport: 'log' | 'smtp';
  message: string;
}

export interface PullInboxToMailpitRequest {
  sinceUid?: number;
  limit?: number;
}

export interface PullInboxToMailpitResponse {
  ok: boolean;
  importedCount: number;
  latestUid: number;
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

export interface ListFoodPlanResponse {
  weekStart: string;
  items: FoodPlanItem[];
}

export interface UpsertFoodPlanItemRequest {
  weekStart: string;
  day: FoodPlanDay;
  dishName: string;
  groceryList?: string[];
}

export interface DeleteFoodPlanItemRequest {
  weekStart: string;
  day: FoodPlanDay;
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
  | 'assignedToMemberId'
> & {
  reminders?: Array<{ minutesBefore: number }>;
  checklist?: Array<{ text: string; isCompleted?: boolean; assignedToMemberId?: string }>;
  invitees?: Array<{ email: string }>;
  parentEntryId?: string;
};

export type UpdateEntryRequest = Partial<CreateEntryRequest> & {
  status?: Entry['status'];
};

export interface UpdateMemberTimelineSettingsRequest {
  enabled?: boolean;
  maxTasksPerDay?: number;
}

export interface ListMemberTimelineTemplatesResponse {
  memberId: string;
  templates: DailyTimelineTemplateTask[];
}

export interface CreateMemberTimelineTemplateRequest {
  title: string;
  position: number;
  expectedTime?: string;
  isActive?: boolean;
  appliesToEntryTask?: boolean;
  appliesToEventDerivedTask?: boolean;
}

export type UpdateMemberTimelineTemplateRequest = Partial<CreateMemberTimelineTemplateRequest>;

export interface UpsertOneOffTimelineTaskRequest {
  title: string;
  dueAt?: string;
  position?: number;
  linkedEntryId?: string;
}

export interface ListTodayMemberTimelineResponse {
  settings: MemberTimelineSettings;
  timeline: TodayMemberTimeline;
}

export interface ConfirmTimelineTaskCompletionRequest {
  taskId: string;
  confirmedAt?: string;
}

export interface ConfirmTimelineTaskCompletionResponse {
  ok: boolean;
  timeline: TodayMemberTimeline;
}
