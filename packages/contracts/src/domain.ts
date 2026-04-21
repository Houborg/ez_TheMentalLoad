export type MemberRole = 'parent' | 'child';
export type EntryType = 'event' | 'task';
export type EntryStatus = 'active' | 'completed' | 'cancelled';
export type SupportedLanguage = 'en' | 'da';
export type SyncProvider = 'none' | 'apple' | 'invite-mail' | 'google' | 'outlook';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ThemeAppearance = 'classic' | 'glass';

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
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPass: string;
  imapSecure: boolean;
  testRecipient: string;
  previewMode: boolean;
  inboxSource?: string;
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

export interface AppSettings {
  id: string;
  theme: ThemeSettings;
  assistant: AssistantConfig;
  mail: MailSettings;
  sync: SyncSettings;
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
