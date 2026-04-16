export type MemberRole = 'parent' | 'child';
export type EntryType = 'event' | 'task';
export type EntryStatus = 'active' | 'completed' | 'cancelled';
export type SupportedLanguage = 'en' | 'da';
export type SyncProvider = 'none' | 'apple' | 'invite-mail';
export interface Member {
    id: string;
    name: string;
    role: MemberRole;
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
}
export interface SyncSettings {
    id: string;
    provider: SyncProvider;
    configJson: Record<string, unknown>;
    isConnected: boolean;
}
