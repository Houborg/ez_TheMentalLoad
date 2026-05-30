import type {
  AppSettings,
  AssistantDraft,
  AulaPresence,
  Calendar,
  DailyTimelineTemplateTask,
  Entry,
  FoodPlanDay,
  FoodPlanItem,
  Member,
  MemberTimelineSettings,
  MemberRole,
  RemoteCalendar,
  SupportedLanguage,
  SyncConnection,
  SyncProvider,
  TodayMemberTimeline,
} from './domain';

export interface ApiHealth {
  status: 'ok';
  service: string;
  persistence?: 'memory' | 'postgres';
  version?: string;
  commit?: string;
  deployedAt?: string | null;
  now: string;
}

export interface DashboardSnapshot {
  members: Member[];
  calendars: Calendar[];
  entries: Entry[];
  reminderJobs?: Array<{ id: string; runAt: string }>;
  persistence?: 'memory' | 'postgres';
  presence?: Record<string, AulaPresence>;
}

export interface AssistantParseRequest {
  message: string;
  memberId: string;
  calendarId: string;
  language?: SupportedLanguage;
  existingDraft?: AssistantDraft;
}

export interface AssistantParseResponse {
  source: 'rule-based' | 'claude' | 'openai' | 'ollama';
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
  source: 'rule-based' | 'claude' | 'openai' | 'ollama';
  response: string;
}

export interface AssistantStatusResponse {
  ok: boolean;
  enabled: boolean;
  reachable: boolean;
  modelAvailable: boolean;
  provider: 'claude' | 'openai' | 'ollama' | 'rule-based';
  modelName?: string;
  message: string;
}

export interface CreateMemberRequest {
  name: string;
  role: MemberRole;
  email?: string;
  avatar?: string;
  color?: string;
}

export interface UpdateMemberRequest {
  name?: string;
  role?: MemberRole;
  email?: string;
  avatar?: string;
  color?: string;
  useAulaSchedule?: boolean;
}

export interface UpdateSettingsRequest {
  id?: string;
  theme?: Partial<AppSettings['theme']>;
  assistant?: Partial<AppSettings['assistant']>;
  mail?: Partial<AppSettings['mail']>;
  sync?: Partial<AppSettings['sync']> & {
    configJson?: Record<string, unknown>;
  };
  weather?: Partial<AppSettings['weather']>;
  language?: AppSettings['language'];
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
  | 'visibleMemberIds'
> & {
  reminders?: Array<{ minutesBefore: number }>;
  checklist?: Array<{ text: string; isCompleted?: boolean; assignedToMemberId?: string }>;
  invitees?: Array<{ email: string }>;
  parentEntryId?: string;
  aulaItemId?: string;
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
  isMilestone?: boolean;
  rewardText?: string;
  appliesToEntryTask?: boolean;
  appliesToEventDerivedTask?: boolean;
}

export type UpdateMemberTimelineTemplateRequest = Partial<CreateMemberTimelineTemplateRequest>;

export interface CreateScheduleEntryRequest {
  dayOfWeek: 1 | 2 | 3 | 4 | 5;
  title: string;
  startTime: string;  // "HH:MM"
  endTime: string;    // "HH:MM"
}

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

export interface CreateSyncConnectionRequest {
  provider: 'apple' | 'google';
  importEnabled: boolean;
  exportEnabled: boolean;
  syncIntervalMinutes?: number;
  // Apple-specific
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
  // Import target selection from wizard
  targetMemberId?: string;
  isSharedCalendar?: boolean;
}

export interface UpdateSyncConnectionRequest {
  importEnabled?: boolean;
  exportEnabled?: boolean;
  syncIntervalMinutes?: number;
  caldavUrl?: string;
  calendarPath?: string;
  calendarName?: string;
}

export interface VerifySyncConnectionRequest {
  provider: SyncProvider;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
}

export interface VerifySyncConnectionResponse {
  ok: boolean;
  message: string;
}

export interface ListRemoteCalendarsRequest {
  provider: SyncProvider;
  appleId?: string;
  caldavUrl?: string;
  appPassword?: string;
}

export interface SyncConnectionRunResponse {
  ok: boolean;
  connectionId: string;
  importedCount: number;
  exportedCount: number;
  lastSyncAt: string;
  message: string;
}

export interface CreateAiMemoryRequest {
  memberId?: string;
  category: import('./domain').AiMemoryCategory;
  key: string;
  value: string;
}

export interface AiAnalyzeRequest {
  triggerType: 'manual';
  context?: string;
}
