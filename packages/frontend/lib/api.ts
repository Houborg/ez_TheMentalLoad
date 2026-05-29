import type {
  ApiHealth,
  AppSettings,
  AssistantFunRequest,
  AssistantFunResponse,
  AssistantConfirmRequest,
  AssistantParseRequest,
  AssistantParseResponse,
  AssistantStatusResponse,
  CreateMemberRequest,
  MailActionResponse,
  DashboardSnapshot,
  Member,
  Entry,
  ListFoodPlanResponse,
  CreateEntryRequest,
  SyncConnectRequest,
  SyncConnectResponse,
  SyncRunRequest,
  SyncRunResponse,
  UpdateEntryRequest,
  UpdateMemberRequest,
  UpdateSettingsRequest,
  TestEmailRequest,
  DeleteFoodPlanItemRequest,
  UpsertFoodPlanItemRequest,
  ConfirmTimelineTaskCompletionRequest,
  ConfirmTimelineTaskCompletionResponse,
  CreateMemberTimelineTemplateRequest,
  ListMemberTimelineTemplatesResponse,
  ListTodayMemberTimelineResponse,
  MemberTimelineSettings,
  UpdateMemberTimelineSettingsRequest,
  UpdateMemberTimelineTemplateRequest,
  UpsertOneOffTimelineTaskRequest,
  MemberScheduleEntry,
  CreateScheduleEntryRequest,
} from '@mental-load/contracts';

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const hasJsonBody = init?.body !== undefined && init?.body !== null && !(init.body instanceof FormData);
  const mergedHeaders = {
    ...(hasJsonBody ? { 'Content-Type': 'application/json' } : {}),
    ...(init?.headers ?? {}),
  };

  const response = await fetch(input, {
    ...init,
    headers: mergedHeaders,
    cache: 'no-store',
  });

  if (!response.ok) {
    const fallback = `Request failed with status ${response.status}`;
    const contentType = response.headers.get('content-type') ?? '';
    try {
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as { message?: string; error?: string };
        throw new Error(payload.message || payload.error || fallback);
      }

      const text = (await response.text()).trim();
      // Don't surface raw HTML (e.g. Cloudflare error pages) as the error message
      if (!text || text.startsWith('<')) throw new Error(fallback);
      throw new Error(text);
    } catch (error) {
      if (error instanceof Error && error.message && error.message !== fallback) {
        throw error;
      }
      throw new Error(fallback);
    }
  }

  // Some endpoints intentionally return 204 with an empty body.
  if (response.status === 204) {
    return undefined as T;
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength === '0') {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getMonthRange(date: Date) {
  const from = new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1, 0, 0, 0));
  const to = new Date(Date.UTC(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59));
  return { from: from.toISOString(), to: to.toISOString() };
}

export function getUpcomingRange(days: number) {
  const from = new Date();
  const to = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function getWeekStart(date = new Date()) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

export async function loadDashboardSnapshot() {
  return fetchJson<DashboardSnapshot>('/api/v1/dashboard');
}

export async function loadMonthOccurrences(date: Date) {
  const range = getMonthRange(date);
  const params = new URLSearchParams(range);
  return fetchJson<Entry[]>(`/api/v1/entries/occurrences?${params.toString()}`);
}

export async function loadUpcomingOccurrences(days = 30) {
  const range = getUpcomingRange(days);
  const params = new URLSearchParams(range);
  return fetchJson<Entry[]>(`/api/v1/entries/occurrences?${params.toString()}`);
}

export async function loadFoodPlan(weekStart = getWeekStart()) {
  return fetchJson<ListFoodPlanResponse>(`/api/v1/food-plan?weekStart=${weekStart}`);
}

export async function loadAssistantStatus() {
  return fetchJson<AssistantStatusResponse>('/api/v1/assistant/status');
}

export async function loadSettings() {
  return fetchJson<AppSettings>('/api/v1/settings');
}

export async function saveSettings(payload: UpdateSettingsRequest) {
  return fetchJson<AppSettings>('/api/v1/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function parseAssistant(payload: AssistantParseRequest) {
  return fetchJson<AssistantParseResponse>('/api/v1/assistant/parse', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmAssistant(payload: AssistantConfirmRequest) {
  return fetchJson<Entry>('/api/v1/assistant/confirm', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function askAssistant(payload: AssistantFunRequest) {
  return fetchJson<AssistantFunResponse>('/api/v1/assistant/fun', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loadHealth() {
  return fetchJson<ApiHealth>('/api/v1/health');
}

export async function createEntry(payload: CreateEntryRequest) {
  return fetchJson<Entry>('/api/v1/entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateEntry(id: string, payload: UpdateEntryRequest) {
  return fetchJson<Entry>(`/api/v1/entries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteEntry(id: string) {
  return fetchJson<void>(`/api/v1/entries/${id}`, {
    method: 'DELETE',
  });
}

export async function updateFoodPlan(payload: UpsertFoodPlanItemRequest) {
  return fetchJson(`/api/v1/food-plan`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function deleteFoodPlan(payload: DeleteFoodPlanItemRequest) {
  const params = new URLSearchParams({ weekStart: payload.weekStart, day: payload.day });
  return fetchJson<void>(`/api/v1/food-plan?${params.toString()}`, {
    method: 'DELETE',
  });
}

export async function loadMembers() {
  return fetchJson<Member[]>('/api/v1/members');
}

export async function createMember(payload: CreateMemberRequest) {
  return fetchJson<Member>('/api/v1/members', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMember(id: string, payload: UpdateMemberRequest) {
  return fetchJson<Member>(`/api/v1/members/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function getMemberSchedule(memberId: string): Promise<MemberScheduleEntry[]> {
  return fetchJson<MemberScheduleEntry[]>(`/api/v1/members/${memberId}/schedule`);
}

export async function createScheduleEntry(memberId: string, payload: CreateScheduleEntryRequest): Promise<MemberScheduleEntry> {
  return fetchJson<MemberScheduleEntry>(`/api/v1/members/${memberId}/schedule`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function deleteScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await fetchJson<void>(`/api/v1/members/${memberId}/schedule/${entryId}`, { method: 'DELETE' });
}

export async function confirmScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await fetchJson<void>(`/api/v1/members/${memberId}/schedule/${entryId}/confirm`, { method: 'POST' });
}

export async function unconfirmScheduleEntry(memberId: string, entryId: string): Promise<void> {
  await fetchJson<void>(`/api/v1/members/${memberId}/schedule/${entryId}/confirm`, { method: 'DELETE' });
}

export async function confirmAulaItem(itemId: string): Promise<void> {
  await fetchJson<void>(`/api/v1/aula/items/${itemId}/confirm`, { method: 'POST' });
}

export async function unconfirmAulaItem(itemId: string): Promise<void> {
  await fetchJson<void>(`/api/v1/aula/items/${itemId}/confirm`, { method: 'DELETE' });
}

export async function deleteCalendar(id: string): Promise<void> {
  await fetchJson<void>(`/api/v1/calendars/${id}`, { method: 'DELETE' });
}

export async function deleteMember(id: string, input?: { actorMemberId?: string }) {
  const params = new URLSearchParams();
  if (input?.actorMemberId) {
    params.set('actorMemberId', input.actorMemberId);
  }
  const query = params.toString();
  const path = query ? `/api/v1/members/${id}?${query}` : `/api/v1/members/${id}`;

  return fetchJson<void>(path, {
    method: 'DELETE',
  });
}

export async function sendTestEmail(payload: TestEmailRequest) {
  return fetchJson<MailActionResponse>('/api/v1/settings/test-email', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}


export async function connectSync(payload: SyncConnectRequest) {
  return fetchJson<SyncConnectResponse>('/api/v1/sync/connect', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runSync(payload: SyncRunRequest) {
  return fetchJson<SyncRunResponse>('/api/v1/sync/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function loadMemberTimelineSettings(memberId: string) {
  return fetchJson<MemberTimelineSettings>(`/api/v1/members/${memberId}/timeline-settings`);
}

export async function updateMemberTimelineSettings(memberId: string, payload: UpdateMemberTimelineSettingsRequest) {
  return fetchJson<MemberTimelineSettings>(`/api/v1/members/${memberId}/timeline-settings`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listMemberTimelineTemplates(memberId: string) {
  return fetchJson<ListMemberTimelineTemplatesResponse>(`/api/v1/members/${memberId}/timeline-templates`);
}

export async function createMemberTimelineTemplate(memberId: string, payload: CreateMemberTimelineTemplateRequest) {
  return fetchJson(`/api/v1/members/${memberId}/timeline-templates`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMemberTimelineTemplate(memberId: string, templateId: string, payload: UpdateMemberTimelineTemplateRequest) {
  return fetchJson(`/api/v1/members/${memberId}/timeline-templates/${templateId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function deleteMemberTimelineTemplate(memberId: string, templateId: string) {
  return fetchJson<void>(`/api/v1/members/${memberId}/timeline-templates/${templateId}`, {
    method: 'DELETE',
  });
}

export async function deleteMemberTimelineTask(memberId: string, taskId: string) {
  return fetchJson<void>(`/api/v1/members/${memberId}/today-timeline/tasks/${taskId}`, {
    method: 'DELETE',
  });
}

export async function loadTodayTimeline(memberId: string, input?: { date?: string; timezone?: string }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set('date', input.date);
  }
  if (input?.timezone) {
    params.set('timezone', input.timezone);
  }
  const query = params.toString();
  const path = query ? `/api/v1/members/${memberId}/today-timeline?${query}` : `/api/v1/members/${memberId}/today-timeline`;
  return fetchJson<ListTodayMemberTimelineResponse>(path);
}

export async function addOneOffTodayTimelineTask(memberId: string, payload: UpsertOneOffTimelineTaskRequest, input?: { date?: string; timezone?: string }) {
  const params = new URLSearchParams();
  if (input?.date) {
    params.set('date', input.date);
  }
  if (input?.timezone) {
    params.set('timezone', input.timezone);
  }
  const query = params.toString();
  const path = query ? `/api/v1/members/${memberId}/today-timeline/one-off?${query}` : `/api/v1/members/${memberId}/today-timeline/one-off`;
  return fetchJson(path, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function confirmTodayTimelineTask(memberId: string, payload: ConfirmTimelineTaskCompletionRequest) {
  return fetchJson<ConfirmTimelineTaskCompletionResponse>(`/api/v1/members/${memberId}/today-timeline/confirm`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function respondToInvitation(entryId: string, email: string, status: 'accepted' | 'declined') {
  return fetchJson<Entry>(`/api/v1/entries/${entryId}/invitees/${encodeURIComponent(email)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function listInvitationsForMember(memberId: string) {
  return fetchJson<Array<{ entry: Entry; invitee: { email: string; status: 'pending' | 'accepted' | 'declined' } }>>(`/api/v1/members/${memberId}/invitations`);
}

export type WeatherDailyPoint = {
  date: string;
  weatherCode: number;
  icon: string;
  tempMax: number;
  tempMin: number;
};

export type WeatherForecastResponse = {
  resolvedLocation: {
    name: string;
    admin1?: string;
    country?: string;
    latitude: number;
    longitude: number;
  };
  unit: 'C' | 'F';
  current: {
    temperature: number;
    weatherCode: number;
    icon: string;
  };
  daily: WeatherDailyPoint[];
};

export async function loadWeatherForecast(input: {
  location: string;
  state?: string;
  country?: string;
  unit?: 'C' | 'F';
  days?: number;
}) {
  const params = new URLSearchParams();
  params.set('location', input.location);
  if (input.state) {
    params.set('state', input.state);
  }
  if (input.country) {
    params.set('country', input.country);
  }
  if (input.unit) {
    params.set('unit', input.unit);
  }
  if (input.days) {
    params.set('days', String(input.days));
  }

  return fetchJson<WeatherForecastResponse>(`/api/weather?${params.toString()}`);
}
