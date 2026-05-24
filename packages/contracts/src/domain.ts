export type MemberRole = 'parent' | 'child';
export type EntryType = 'event' | 'task';
export type EntryStatus = 'active' | 'completed' | 'cancelled';
export type SupportedLanguage = 'en' | 'da';
export type SyncProvider = 'none' | 'apple' | 'google' | 'outlook';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeAppearance = 'classic' | 'glass';
export type TimelineTaskStatus = 'pending' | 'waiting_confirmation' | 'completed' | 'skipped';
export type TimelineTaskSource = 'template' | 'one_off' | 'entry_task' | 'event_derived_task';

export interface Member {
  id: string;
  name: string;
  role: MemberRole;
  email?: string;
  avatar?: string;
  createdAt: string;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  ownerMemberId: string;
  createdAt: string;
}

export interface ReminderConfig {
  id: string;
  minutesBefore: number;
}

export interface ChecklistItem {
  id: string;
  text: string;
  isCompleted: boolean;
  assignedToMemberId?: string;
}

export interface Invitee {
  id: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined';
}

export interface Entry {
  id: string;
  title: string;
  type: EntryType;
  ownerMemberId: string;
  calendarId: string;
  startTime: string;
  endTime: string;
  timezone: string;
  allDay: boolean;
  reminders: ReminderConfig[];
  checklist: ChecklistItem[];
  status: EntryStatus;
  location?: string;
  recurrenceRule?: string;
  invitees: Invitee[];
  linkedEntryIds: string[];
  parentEntryId?: string;
  assignedToMemberId?: string;
  externalUid?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatConversation {
  id: string;
  memberId: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface AssistantConfig {
  id: string;
  modelName: string;
  language: SupportedLanguage;
  enabled: boolean;
  ollamaUrl?: string;
  tone?: 'informal' | 'formal';
  customInstructions?: string;
}

export interface ThemeSettings {
  mode: ThemeMode;
  appearance: ThemeAppearance;
}

export interface MailSettings {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;
  testRecipient: string;
  previewMode: boolean;
  lastSyncAt?: string;
}

export interface AssistantDraft {
  type: EntryType;
  title: string;
  ownerMemberId: string;
  calendarId: string;
  startTime?: string;
  endTime?: string;
  timezone: string;
  allDay: boolean;
  recurrenceRule?: string;
  location?: string;
  reminders: Array<{ minutesBefore: number }>;
}

export interface SyncSettings {
  id: string;
  provider: SyncProvider;
  configJson: Record<string, unknown>;
  isConnected: boolean;
  lastSyncAt?: string;
}

export interface SyncConnection {
  id: string;
  provider: SyncProvider;
  isConnected: boolean;
  importEnabled: boolean;
  exportEnabled: boolean;
  // Apple CalDAV fields
  appleId?: string;
  caldavUrl?: string;
  /** Stored encrypted server-side. MUST be stripped from API responses before sending to the client. */
  appPassword?: string;
  calendarPath?: string;
  calendarName?: string;
  // Import target — which local calendar/member to assign imported events to
  targetCalendarId?: string;
  targetMemberId?: string;
  // Shared
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastImportCount?: number;
  lastExportCount?: number;
  createdAt: string;
}

export interface RemoteCalendar {
  url: string;
  displayName: string;
  eventCount?: number;
}

export interface WeatherSettings {
  location: string;
  country: string;
  unit: 'C' | 'F';
}

export interface AppSettings {
  id: string;
  theme: ThemeSettings;
  assistant: AssistantConfig;
  mail: MailSettings;
  sync: SyncSettings;
  weather: WeatherSettings;
  language: SupportedLanguage;
  updatedAt: string;
}

export type FoodPlanDay = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface FoodPlanItem {
  id: string;
  weekStart: string;
  day: FoodPlanDay;
  dishName: string;
  groceryList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MemberTimelineSettings {
  memberId: string;
  enabled: boolean;
  maxTasksPerDay: number;
  updatedAt: string;
}

export interface DailyTimelineTemplateTask {
  id: string;
  memberId: string;
  title: string;
  position: number;
  expectedTime?: string;
  isActive: boolean;
  isMilestone: boolean;
  rewardText?: string;
  appliesToEntryTask: boolean;
  appliesToEventDerivedTask: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineTaskInstance {
  id: string;
  dayId: string;
  memberId: string;
  title: string;
  position: number;
  source: TimelineTaskSource;
  status: TimelineTaskStatus;
  dueAt?: string;
  confirmedAt?: string;
  linkedEntryId?: string;
  templateTaskId?: string;
  isMilestone: boolean;
  rewardText?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TodayMemberTimeline {
  memberId: string;
  date: string;
  timezone: string;
  blockedByTaskId?: string;
  tasks: TimelineTaskInstance[];
}

export type AulaPresenceStatus =
  | 'tilstede'
  | 'ikke_ankommet'
  | 'hentet'
  | 'syg'
  | 'ferie'
  | 'fri';

export interface AulaPresence {
  status: AulaPresenceStatus | string; // unknown statuses pass through
  statusLabel: string;
  entryTime?: string;
  exitTime?: string;
  comment?: string;
  asOf: string;          // ISO 8601 datetime — when this state was observed
}

export interface AulaMuTask {
  id: string;
  title: string;
  subject?: string;
  dueDate: string;       // YYYY-MM-DD
  description?: string;  // HTML
  status: 'open' | 'done' | string;
  url?: string;
}

export interface AulaWeekplanLesson {
  childId: number;
  date: string;          // YYYY-MM-DD
  startTime?: string;    // HH:MM in Europe/Copenhagen
  endTime?: string;
  title: string;
  description?: string;  // HTML
  source: 'meebook' | 'easyiq' | 'ugeplan';
  seq: number;
}
