// packages/backend/src/aula/aula-types.ts

export interface AulaTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
}

export interface AulaChildMapping {
  aulaChildId: number;
  aulaChildName: string;
  mentalLoadMemberId: string;
  calendarId: string;
}

export interface AulaSyncOptions {
  importToCalendar: boolean; // master gate — off by default during dev
  calendarEvents: boolean;
  dailyOverview: boolean;
  posts: boolean;
  messages: boolean;
  muTasks: boolean;    // MinUddannelse homework
  presence: boolean;   // current presence state per child
}

export interface AulaConnection extends AulaTokens {
  id: string;
  tokenData?: Record<string, unknown>; // full blob from Python FileTokenStorage — needed for sidecar API calls
  isConnected: boolean;
  aulaUsername: string;
  childMappings: AulaChildMapping[];
  syncOptions: AulaSyncOptions;
  syncIntervalMinutes: number;
  lastSyncAt?: string;
  lastSyncStats?: {
    entriesCreated: number;
    itemsCreated: number;
  };
  createdAt: string;
}

// Public view — tokens stripped
export type AulaConnectionPublic = Omit<AulaConnection, 'accessToken' | 'refreshToken'>;

export interface AulaChild {
  id: number;
  name: string;
  institutionName: string;
}

export interface AulaCalendarEvent {
  id: string | number;
  title: string;
  startTime: string;   // ISO
  endTime: string;     // ISO
  allDay: boolean;
  location?: string;
  description?: string;
  childId: number;
}

export interface AulaPost {
  id: string | number;
  title?: string;
  body: string;
  author?: string;
  publishedAt?: string;
}

export interface AulaMessage {
  id: string | number;
  threadId: number;
  subject?: string;
  body: string;
  author?: string;
  sentAt?: string;
}

export interface AulaDailyOverview {
  childId: number;
  date: string; // YYYY-MM-DD
  status?: string;
  entryTime?: string;
  exitTime?: string;
}

export class AulaAuthExpiredError extends Error {
  constructor() {
    super('Aula token refresh failed — re-authentication required');
    this.name = 'AulaAuthExpiredError';
  }
}

export class AulaLoginError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_credentials' | 'expired_code' | 'network_error' | 'unknown',
  ) {
    super(message);
    this.name = 'AulaLoginError';
  }
}
