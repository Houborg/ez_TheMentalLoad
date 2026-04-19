import { FormEvent, Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import confetti from 'canvas-confetti';
import type {
  AppSettings,
  AssistantStatusResponse,
  Calendar,
  DashboardSnapshot,
  Entry,
  FoodPlanDay,
  FoodPlanItem,
  ListFoodPlanResponse,
  Member,
  ThemeAppearance,
  PullInboxToMailpitResponse,
} from '@mental-load/contracts';

const sampleIcs = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Imported school event', 'DTSTART:20260428T080000Z', 'DTEND:20260428T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const AGENDA_DAYS = 6;
const FOOD_DAYS: FoodPlanDay[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const WEATHER_CODE_MAP: Record<number, string> = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Cloudy',
  45: 'Fog',
  48: 'Fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Rain showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
};

const MAILPIT_DOCKER_DEFAULTS = {
  smtpHost: 'mailpit',
  smtpPort: 1025,
  smtpUser: '',
  smtpPass: '',
  smtpFrom: 'mental-load@local.test',
  testRecipient: 'qa@local.test',
  previewMode: false,
} as const;

const USER_DEFAULT_MAIL_SETTINGS = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpUser: 'your-user@example.com',
  smtpPass: '',
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapUser: 'your-user@example.com',
  imapPass: '',
  smtpFrom: 'mental-load@local.test',
  testRecipient: 'family@local.test',
  previewMode: false,
} as const;

type AppView = 'planner' | 'settings';
type SettingsTab = 'members' | 'mailpit' | 'weather' | 'sync' | 'theme' | 'birthdays' | 'recurring' | 'ai' | 'general';
type EditableMember = { name: string; role: Member['role']; email: string };
type EditableEntry = { id: string; title: string; status: Entry['status']; startTime: string; endTime: string };
type WeatherDayForecast = { code: number; icon: string; label: string; temperatureC?: number };
type GeocodingResult = { name: string; latitude: number; longitude: number; country?: string; admin1?: string };
type EventModalDraft = {
  entryId?: string;
  dateKey: string;
  title: string;
  type: Entry['type'];
  ownerMemberId: string;
  inviteeMemberIds: string[];
  calendarId: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  taskLines: string;
  existingTasks: Array<{ id: string; title: string; status: Entry['status'] }>;
};
type FoodModalDraft = {
  day: FoodPlanDay;
  dishName: string;
  groceryText: string;
  suggestions: string[];
  loadingSuggestions: boolean;
};

type FoodEditorState = Record<FoodPlanDay, { dishName: string; groceryText: string; open: boolean }>;
type RecurringWeekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export default function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [memberEdits, setMemberEdits] = useState<Record<string, EditableMember>>({});
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState('Loading planner...');
  const [currentView, setCurrentView] = useState<AppView>('planner');
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('members');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [reminderJobs, setReminderJobs] = useState(0);
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<Member['role']>('child');
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [birthdayName, setBirthdayName] = useState('');
  const [birthdayDate, setBirthdayDate] = useState('2026-05-01');
  const [recurringTitle, setRecurringTitle] = useState('Soccer training');
  const [recurringMemberId, setRecurringMemberId] = useState('');
  const [recurringCalendarId, setRecurringCalendarId] = useState('');
  const [recurringWeekday, setRecurringWeekday] = useState<RecurringWeekday>('wednesday');
  const [recurringStartClock, setRecurringStartClock] = useState('17:30');
  const [recurringEndClock, setRecurringEndClock] = useState('19:30');
  const [funPrompt, setFunPrompt] = useState('Write a cheerful one-liner');
  const [funReply, setFunReply] = useState('Ask the AI playground anything fun about family planning.');
  const [editingEntry, setEditingEntry] = useState<EditableEntry | null>(null);
  const [weatherByDate, setWeatherByDate] = useState<Record<string, WeatherDayForecast>>({});
  const [weatherLookupBusy, setWeatherLookupBusy] = useState(false);
  const [weatherLookupNote, setWeatherLookupNote] = useState('');
  const [eventModalDraft, setEventModalDraft] = useState<EventModalDraft | null>(null);
  const [foodModalDraft, setFoodModalDraft] = useState<FoodModalDraft | null>(null);
  const [foodPlan, setFoodPlan] = useState<Record<FoodPlanDay, FoodPlanItem | undefined>>({
    monday: undefined,
    tuesday: undefined,
    wednesday: undefined,
    thursday: undefined,
    friday: undefined,
    saturday: undefined,
    sunday: undefined,
  });
  const [, setFoodEditor] = useState<FoodEditorState>(() => createEmptyFoodEditor());

  const agendaDays = useMemo(() => buildAgendaDays(), []);
  const monthDays = useMemo(() => buildMonthDays(new Date()), []);
  const weekStart = useMemo(() => currentWeekMonday(), []);
  const todayDateKey = useMemo(() => {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return dateKeyFromDate(now);
  }, []);

  const memberById = useMemo(
    () => members.reduce<Record<string, Member>>((acc, member) => {
      acc[member.id] = member;
      return acc;
    }, {}),
    [members],
  );

  const memberColorById = useMemo(() => {
    const palette = ['#4d8fd6', '#d68ab0', '#a76edb', '#43b887', '#5966d4', '#d48954'];
    return members.reduce<Record<string, string>>((acc, member, index) => {
      acc[member.id] = palette[index % palette.length];
      return acc;
    }, {});
  }, [members]);

  const entriesByDate = useMemo(
    () => entries.reduce<Record<string, Entry[]>>((acc, entry) => {
      const dateKey = entryDateKey(entry.startTime);
      if (!acc[dateKey]) {
        acc[dateKey] = [];
      }
      acc[dateKey].push(entry);
      return acc;
    }, {}),
    [entries],
  );

  const entriesByDateAndMember = useMemo(
    () => entries.reduce<Record<string, Entry[]>>((acc, entry) => {
      const key = `${entryDateKey(entry.startTime)}|${entry.ownerMemberId}`;
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(entry);
      return acc;
    }, {}),
    [entries],
  );

  const todaysTasks = useMemo(
    () => (entriesByDate[todayDateKey] ?? [])
      .filter((entry) => entry.type === 'task')
      .slice()
      .sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [entriesByDate, todayDateKey],
  );

  const entryIdsWithTasks = useMemo(
    () => new Set(
      entries
        .filter((entry) => entry.type === 'task' && entry.parentEntryId)
        .map((entry) => entry.parentEntryId as string),
    ),
    [entries],
  );

  const entryIdsWithPendingTasks = useMemo(
    () => new Set(
      entries
        .filter((e) => e.type === 'task' && e.parentEntryId && e.status !== 'completed')
        .map((e) => e.parentEntryId as string),
    ),
    [entries],
  );

  const entryIdsWithAllTasksDone = useMemo(() => {
    const parentMap = new Map<string, boolean>();
    for (const e of entries) {
      if (e.type === 'task' && e.parentEntryId) {
        const pid = e.parentEntryId;
        if (!parentMap.has(pid)) parentMap.set(pid, true);
        if (e.status !== 'completed') parentMap.set(pid, false);
      }
    }
    const result = new Set<string>();
    parentMap.forEach((allDone, id) => { if (allDone) result.add(id); });
    return result;
  }, [entries]);

  useEffect(() => {
    void initializePlanner();

    if (window.navigator.webdriver) {
      setStatus('Planner ready');
      return;
    }

    const socket = new WebSocket(webSocketUrl('/ws'));
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data) as { type: string };
      if (message.type !== 'connected') {
        setStatus(`Live update received: ${message.type}`);
        void loadDashboard();
      }
    };

    socket.onopen = () => setStatus('Live sync connected');
    socket.onerror = () => setStatus('Live sync unavailable, using refresh');

    return () => socket.close();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const modeSetting = settings?.theme.mode ?? 'light';
    const appearanceSetting = settings?.theme.appearance ?? 'classic';

    const applyTheme = () => {
      const resolvedMode = modeSetting === 'system'
        ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : modeSetting;
      root.dataset.theme = resolvedMode;
      root.dataset.appearance = appearanceSetting;
    };

    applyTheme();

    if (modeSetting !== 'system') {
      return;
    }

    const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => applyTheme();

    darkModeQuery.addEventListener('change', handleSystemThemeChange);
    return () => darkModeQuery.removeEventListener('change', handleSystemThemeChange);
  }, [settings?.theme.mode, settings?.theme.appearance]);

  const activeMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId),
    [members, selectedMemberId],
  );

  const birthdayEntries = useMemo(
    () => {
      const sorted = entries
        .filter((entry) => isBirthdayTitle(entry.title))
        .sort((left, right) => left.startTime.localeCompare(right.startTime));

      const uniqueByBaseId = new Map<string, Entry>();
      for (const entry of sorted) {
        const baseId = toBaseEntryId(entry.id);
        if (!uniqueByBaseId.has(baseId)) {
          uniqueByBaseId.set(baseId, entry);
        }
      }

      return [...uniqueByBaseId.values()];
    },
    [entries],
  );

  function updateLocalSettings(updater: (current: AppSettings) => AppSettings): void {
    setSettings((current) => (current ? updater(current) : current));
  }

  async function loadDashboard(): Promise<void> {
    try {
      const now = new Date();
      const inSevenDays = new Date(now.getTime() + AGENDA_DAYS * 24 * 60 * 60 * 1000);
      const query = new URLSearchParams({ from: now.toISOString(), to: inSevenDays.toISOString() });

      const [dashboardResponse, occurrencesResponse, remindersResponse] = await Promise.all([
        fetch(apiUrl('/api/v1/dashboard')),
        fetch(apiUrl(`/api/v1/entries/occurrences?${query.toString()}`)),
        fetch(apiUrl('/api/v1/reminders/jobs')),
      ]);

      if (!dashboardResponse.ok) {
        throw new Error('Dashboard request failed');
      }

      const data = (await dashboardResponse.json()) as DashboardSnapshot;
      setMembers(data.members);
      setCalendars(data.calendars);
      setMemberEdits(toMemberEditMap(data.members));

      if (occurrencesResponse.ok) {
        const upcoming = (await occurrencesResponse.json()) as Entry[];
        setEntries(upcoming);
      } else {
        setEntries(data.entries);
      }

      if (remindersResponse.ok) {
        const jobs = (await remindersResponse.json()) as Array<{ id: string }>;
        setReminderJobs(jobs.length);
      }

      if (data.members[0] && !selectedMemberId) {
        setSelectedMemberId(data.members[0].id);
      }

      if (data.calendars[0] && !selectedCalendarId) {
        setSelectedCalendarId(data.calendars[0].id);
      }
    } catch {
      setStatus('Planner API unavailable, retrying');
      window.setTimeout(() => {
        void loadDashboard();
      }, 1000);
    }
  }

  async function initializePlanner(): Promise<void> {
    await Promise.all([loadDashboard(), loadFoodPlan()]);
    const loadedSettings = await loadSettings();
    await loadWeather(loadedSettings);
  }

  async function loadSettings(): Promise<AppSettings | undefined> {
    try {
      const response = await fetch(apiUrl('/api/v1/settings'));
      if (!response.ok) {
        throw new Error('Settings request failed');
      }

      const data = (await response.json()) as AppSettings;
      setSettings(data);
      return data;
    } catch {
      setStatus('Settings unavailable, using defaults');
      window.setTimeout(() => {
        void loadSettings();
      }, 1000);
      return undefined;
    }
  }

  async function loadWeather(loadedSettings = settings): Promise<void> {
    try {
      const weatherConfig = getWeatherConfig(loadedSettings);
      const query = new URLSearchParams({
        latitude: `${weatherConfig.latitude}`,
        longitude: `${weatherConfig.longitude}`,
        daily: 'weathercode,temperature_2m_max',
        timezone: 'auto',
        forecast_days: `${weatherConfig.forecastDays}`,
      });
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query.toString()}`);
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as {
        daily?: { time?: string[]; weathercode?: number[]; temperature_2m_max?: number[] };
      };

      const times = payload.daily?.time ?? [];
      const codes = payload.daily?.weathercode ?? [];
      const highs = payload.daily?.temperature_2m_max ?? [];
      const next: Record<string, WeatherDayForecast> = {};
      for (let index = 0; index < times.length; index += 1) {
        const code = codes[index] ?? -1;
        const label = WEATHER_CODE_MAP[code] ?? 'Weather';
        const icon = weatherIconForCode(code);
        const temperatureC = typeof highs[index] === 'number' ? Math.round(highs[index]) : undefined;
        const key = normalizeWeatherDateKey(times[index]);
        next[key] = {
          code,
          icon,
          label,
          temperatureC,
        };
      }
      setWeatherByDate(next);
    } catch {
      // Keep weather optional.
    }
  }

  async function loadFoodPlan(): Promise<void> {
    const response = await fetch(apiUrl(`/api/v1/food-plan?weekStart=${weekStart}`));
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as ListFoodPlanResponse;
    const mapped: Record<FoodPlanDay, FoodPlanItem | undefined> = {
      monday: undefined,
      tuesday: undefined,
      wednesday: undefined,
      thursday: undefined,
      friday: undefined,
      saturday: undefined,
      sunday: undefined,
    };

    for (const item of data.items) {
      mapped[item.day] = item;
    }

    setFoodPlan(mapped);
    setFoodEditor(buildFoodEditor(mapped));
  }

  async function askFunAssistant(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/v1/assistant/fun'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: funPrompt,
          language: settings?.assistant.language ?? 'en',
        }),
      });

      const result = (await response.json()) as { response?: string };
      setFunReply(result.response ?? 'The AI playground is quiet right now.');
      setStatus(response.ok ? 'AI playground answered' : 'AI playground unavailable');
    } catch {
      setFunReply('The AI playground is quiet right now.');
      setStatus('AI playground unavailable');
    }
  }

  async function testOllamaConnection(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/v1/assistant/status'));
      const result = (await response.json()) as AssistantStatusResponse;
      setFunReply(result.message);
      setStatus(result.ok ? 'Ollama ready' : 'Ollama fallback active');
    } catch {
      setFunReply('Could not reach the backend assistant status endpoint.');
      setStatus('Ollama status check failed');
    }
  }

  async function deleteBirthday(entryId: string): Promise<void> {
    const baseEntryId = toBaseEntryId(entryId);
    const linkedTasks = entries.filter((entry) =>
      entry.type === 'task' && (entry.parentEntryId === entryId || entry.parentEntryId === baseEntryId),
    );

    const uniqueTaskIds = new Set(linkedTasks.map((task) => toBaseEntryId(task.id)));
    for (const taskId of uniqueTaskIds) {
      await fetch(apiUrl(`/api/v1/entries/${taskId}`), { method: 'DELETE' });
    }

    const response = await fetch(apiUrl(`/api/v1/entries/${baseEntryId}`), { method: 'DELETE' });
    if (!response.ok) {
      setStatus('Could not delete birthday');
      return;
    }

    setStatus('Birthday deleted');
    await loadDashboard();
  }

  async function saveSettings(): Promise<void> {
    if (!settings) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/settings'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ message: 'Could not save settings' }));
      setStatus(payload.message ?? 'Could not save settings');
      return;
    }

    const next = (await response.json()) as AppSettings;
    setSettings(next);
    await loadWeather(next);
    setStatus('Settings saved');
  }

  async function resolveWeatherTown(inputTown?: string): Promise<void> {
    if (!settings) {
      return;
    }

    const configured = getWeatherConfig(settings);
    const town = (inputTown ?? configured.locationName).trim();
    if (!town) {
      setStatus('Type a town name first');
      return;
    }

    setWeatherLookupBusy(true);
    setWeatherLookupNote('Looking up coordinates...');

    try {
      const query = new URLSearchParams({ name: town, count: '1', language: 'en', format: 'json' });
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${query.toString()}`);
      if (!response.ok) {
        setWeatherLookupNote('Could not look up town right now');
        setStatus('Weather town lookup failed');
        return;
      }

      const payload = (await response.json()) as { results?: GeocodingResult[] };
      const match = payload.results?.[0];
      if (!match) {
        setWeatherLookupNote('No matching town found');
        setStatus('Weather town not found');
        return;
      }

      const next: AppSettings = {
        ...settings,
        sync: {
          ...settings.sync,
          configJson: {
            ...settings.sync.configJson,
            weatherLocationName: match.name,
            weatherLatitude: match.latitude,
            weatherLongitude: match.longitude,
          },
        },
      };
      setSettings(next);
      setWeatherLookupNote(
        `${match.name}${match.admin1 ? `, ${match.admin1}` : ''}${match.country ? ` (${match.country})` : ''}: ${match.latitude.toFixed(4)}, ${match.longitude.toFixed(4)}`,
      );
      setStatus('Weather location resolved');
      await loadWeather(next);
    } catch {
      setWeatherLookupNote('Could not look up town right now');
      setStatus('Weather town lookup failed');
    } finally {
      setWeatherLookupBusy(false);
    }
  }

  function openCreateEventModal(dateKey: string, preferredMemberId?: string): void {
    const selectedMember = preferredMemberId || selectedMemberId || members[0]?.id || '';
    const selectedCalendar = selectedCalendarId || calendars[0]?.id || '';
    const { start, end } = buildDefaultTimesForDate(dateKey);
    setEventModalDraft({
      entryId: undefined,
      dateKey,
      title: '',
      type: 'event',
      ownerMemberId: selectedMember,
      inviteeMemberIds: [],
      calendarId: selectedCalendar,
      startTime: start,
      endTime: end,
      allDay: false,
      taskLines: '',
      existingTasks: [],
    });
  }

  function openExistingEventModal(entry: Entry): void {
    const dateKey = entryDateKey(entry.startTime);
    const baseEntryId = toBaseEntryId(entry.id);
    const linkedTasks = entries
      .filter((candidate) => candidate.type === 'task' && (candidate.parentEntryId === entry.id || candidate.parentEntryId === baseEntryId))
      .sort((left, right) => left.startTime.localeCompare(right.startTime));

    setEventModalDraft({
      entryId: baseEntryId,
      dateKey,
      title: entry.title,
      type: entry.type,
      ownerMemberId: entry.ownerMemberId,
      inviteeMemberIds: [],
      calendarId: entry.calendarId,
      startTime: toDateTimeLocal(new Date(entry.startTime)),
      endTime: toDateTimeLocal(new Date(entry.endTime)),
      allDay: entry.allDay,
      taskLines: '',
      existingTasks: linkedTasks.map((task) => ({ id: toBaseEntryId(task.id), title: task.title, status: task.status })),
    });
  }

  async function createEventFromModal(): Promise<void> {
    if (!eventModalDraft) {
      return;
    }

    if (!eventModalDraft.title.trim() || !eventModalDraft.ownerMemberId || !eventModalDraft.calendarId) {
      setStatus('Title, member, and calendar are required');
      return;
    }

    const payload = {
      title: eventModalDraft.title.trim(),
      type: eventModalDraft.type,
      ownerMemberId: eventModalDraft.ownerMemberId,
      calendarId: eventModalDraft.calendarId,
      startTime: new Date(eventModalDraft.startTime).toISOString(),
      endTime: new Date(eventModalDraft.endTime).toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      allDay: eventModalDraft.allDay,
      invitees: [
        ...(members.find((m) => m.id === eventModalDraft.ownerMemberId)?.email?.trim()
          ? [{ email: members.find((m) => m.id === eventModalDraft.ownerMemberId)!.email!.trim() }]
          : []),
        ...eventModalDraft.inviteeMemberIds
          .map((memberId) => members.find((member) => member.id === memberId)?.email?.trim() ?? '')
          .filter((email) => email.length > 0)
          .map((email) => ({ email })),
      ],
    };

    const response = await fetch(
      eventModalDraft.entryId ? apiUrl(`/api/v1/entries/${eventModalDraft.entryId}`) : apiUrl('/api/v1/entries'),
      {
        method: eventModalDraft.entryId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      setStatus(eventModalDraft.entryId ? 'Could not update event' : 'Could not create event');
      return;
    }

    const updatedOrCreated = (await response.json()) as Entry;
    try {
      await syncEventTasks(updatedOrCreated, eventModalDraft.taskLines);
    } catch {
      setStatus('Event saved, but one or more tasks failed to create');
      await loadDashboard();
      return;
    }

    setEventModalDraft(null);
    setStatus(eventModalDraft.entryId ? 'Event updated' : 'Event created');
    await loadDashboard();
  }

  async function deleteEventFromModal(): Promise<void> {
    if (!eventModalDraft?.entryId) {
      return;
    }

    const baseEntryId = toBaseEntryId(eventModalDraft.entryId);
    const linkedTasks = entries.filter((entry) =>
      entry.type === 'task' && (entry.parentEntryId === eventModalDraft.entryId || entry.parentEntryId === baseEntryId),
    );
    for (const task of linkedTasks) {
      await fetch(apiUrl(`/api/v1/entries/${toBaseEntryId(task.id)}`), { method: 'DELETE' });
    }

    const response = await fetch(apiUrl(`/api/v1/entries/${baseEntryId}`), { method: 'DELETE' });
    if (!response.ok) {
      setStatus('Could not delete event');
      return;
    }

    setEventModalDraft(null);
    setStatus('Event deleted');
    await loadDashboard();
  }

  async function toggleTaskComplete(taskId: string, completed: boolean): Promise<void> {
    const newStatus: Entry['status'] = completed ? 'completed' : 'active';
    const baseTaskId = toBaseEntryId(taskId);
    const response = await fetch(apiUrl(`/api/v1/entries/${baseTaskId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!response.ok) return;
    if (completed) {
      void confetti({ particleCount: 100, spread: 80, origin: { y: 0.6 } });
    }
    setEventModalDraft((current) => {
      if (!current) return current;
      return { ...current, existingTasks: current.existingTasks.map((t) => t.id === taskId ? { ...t, status: newStatus } : t) };
    });
    await loadDashboard();
  }

  async function deleteExistingTask(taskId: string): Promise<void> {
    const response = await fetch(apiUrl(`/api/v1/entries/${toBaseEntryId(taskId)}`), { method: 'DELETE' });
    if (!response.ok) return;
    setEventModalDraft((current) => {
      if (!current) return current;
      return { ...current, existingTasks: current.existingTasks.filter((t) => t.id !== taskId) };
    });
  }

  async function syncEventTasks(parentEntry: Entry, taskLines: string): Promise<void> {
    const taskTitles = taskLines.split('\n').map((line) => line.trim()).filter(Boolean);
    const parentEntryId = toBaseEntryId(parentEntry.id);

    for (const title of taskTitles) {
      const response = await fetch(apiUrl('/api/v1/entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          type: 'task',
          ownerMemberId: parentEntry.ownerMemberId,
          calendarId: parentEntry.calendarId,
          startTime: parentEntry.startTime,
          endTime: parentEntry.endTime,
          timezone: parentEntry.timezone,
          allDay: parentEntry.allDay,
          parentEntryId,
          reminders: [],
        }),
      });

      if (!response.ok) {
        throw new Error('Could not create task');
      }
    }
  }

  function openFoodDayModal(day: FoodPlanDay): void {
    const item = foodPlan[day];
    setFoodModalDraft({
      day,
      dishName: item?.dishName ?? '',
      groceryText: item?.groceryList.join('\n') ?? '',
      suggestions: [],
      loadingSuggestions: false,
    });
  }

  async function saveFoodModal(): Promise<void> {
    if (!foodModalDraft) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/food-plan'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        weekStart,
        day: foodModalDraft.day,
        dishName: foodModalDraft.dishName,
        groceryList: foodModalDraft.groceryText.split('\n').map((item) => item.trim()).filter(Boolean),
      }),
    });

    if (!response.ok) {
      setStatus('Could not save food plan item');
      return;
    }

    setStatus(`Saved ${capitalize(foodModalDraft.day)} meal`);
    setFoodModalDraft(null);
    await loadFoodPlan();
  }

  async function clearFoodModal(): Promise<void> {
    if (!foodModalDraft) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/food-plan'), {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weekStart, day: foodModalDraft.day }),
    });

    if (!response.ok && response.status !== 404) {
      setStatus('Could not delete food plan item');
      return;
    }

    setStatus(`${capitalize(foodModalDraft.day)} meal cleared`);
    setFoodModalDraft(null);
    await loadFoodPlan();
  }

  async function suggestFoodDishes(): Promise<void> {
    if (!foodModalDraft) {
      return;
    }

    setFoodModalDraft((current) => (current ? { ...current, loadingSuggestions: true } : current));

    try {
      const response = await fetch(apiUrl('/api/v1/assistant/fun'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Suggest 6 family dinner dishes for ${foodModalDraft.day}. Return one dish per line only.`,
          language: settings?.assistant.language ?? 'en',
        }),
      });

      const payload = (await response.json()) as { response?: string };
      const suggestions = (payload.response ?? '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*0-9.)\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 6);

      setFoodModalDraft((current) => (current ? {
        ...current,
        suggestions: suggestions.length > 0 ? suggestions : ['Pasta primavera', 'Chicken wraps', 'Vegetable soup'],
        loadingSuggestions: false,
      } : current));
    } catch {
      setFoodModalDraft((current) => (current ? {
        ...current,
        suggestions: ['Pasta primavera', 'Chicken wraps', 'Vegetable soup'],
        loadingSuggestions: false,
      } : current));
    }
  }

  async function connectSync(): Promise<void> {
    if (!settings) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/sync/connect'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.sync.provider,
        configJson: settings.sync.configJson,
      }),
    });

    const result = (await response.json()) as { isConnected?: boolean; message?: string };
    if (response.ok) {
      updateLocalSettings((current) => ({
        ...current,
        sync: {
          ...current.sync,
          isConnected: Boolean(result.isConnected),
        },
      }));
    }

    setStatus(result.message ?? (response.ok ? 'Sync connected' : 'Sync connection failed'));
  }

  async function sendTestEmail(): Promise<void> {
    if (!settings) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/settings/test-email'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: settings.mail.testRecipient }),
    });

    const result = (await response.json()) as { message?: string };
    setStatus(result.message ?? (response.ok ? 'Test email sent' : 'Email failed'));
  }

  async function testEventWithIcsInvite(): Promise<void> {
    if (!selectedMemberId || !selectedCalendarId) {
      setStatus('Choose a member and calendar first');
      return;
    }

    try {
      const owner = members.find((m) => m.id === selectedMemberId);
      const ownerEmail = owner?.email?.trim();
      const testTime = new Date();
      testTime.setHours(testTime.getHours() + 1, 0, 0, 0);
      const endTime = new Date(testTime.getTime() + 60 * 60 * 1000);

      const response = await fetch(apiUrl('/api/v1/entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `🧪 Test Event [${new Date().toLocaleTimeString()}]`,
          type: 'event',
          ownerMemberId: selectedMemberId,
          calendarId: selectedCalendarId,
          startTime: testTime.toISOString(),
          endTime: endTime.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          allDay: false,
          reminders: [],
          invitees: ownerEmail ? [{ email: ownerEmail }] : [],
        }),
      });

      if (!response.ok) {
        setStatus('Test event creation failed');
        return;
      }

      const recipient = ownerEmail || settings?.mail.testRecipient || 'unknown';
      setStatus(`✅ Test event created! ICS invite sent to: ${recipient}. Check Mailpit at http://localhost:8025 or your email inbox.`);
      await loadDashboard();
    } catch {
      setStatus('Test event creation error');
    }
  }

  async function pullInboxToMailpit(): Promise<void> {
    const response = await fetch(apiUrl('/api/v1/mailpit/pull-inbox'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 25 }),
    });

    const result = (await response.json()) as PullInboxToMailpitResponse;
    setStatus(result.message ?? (response.ok ? 'Inbox pull completed' : 'Inbox pull failed'));
    await loadSettings();
  }

  function getMailpitPullMinutes(): number {
    const value = Number(settings?.sync.configJson.mailpitPullMinutes ?? 1);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  }

  function isMailpitAutoPullEnabled(): boolean {
    return settings?.sync.configJson.mailpitAutoPullEnabled !== false;
  }

  function applyMailpitDefaults(): void {
    updateLocalSettings((current) => ({
      ...current,
      mail: {
        ...current.mail,
        smtpHost: MAILPIT_DOCKER_DEFAULTS.smtpHost,
        smtpPort: MAILPIT_DOCKER_DEFAULTS.smtpPort,
        smtpUser: MAILPIT_DOCKER_DEFAULTS.smtpUser,
        smtpPass: MAILPIT_DOCKER_DEFAULTS.smtpPass,
        smtpFrom: MAILPIT_DOCKER_DEFAULTS.smtpFrom,
        testRecipient: MAILPIT_DOCKER_DEFAULTS.testRecipient,
        previewMode: MAILPIT_DOCKER_DEFAULTS.previewMode,
      },
    }));
    setStatus('Mailpit defaults applied. Save settings to persist.');
  }

  function applyMyDefaults(): void {
    updateLocalSettings((current) => ({
      ...current,
      mail: {
        ...current.mail,
        smtpHost: USER_DEFAULT_MAIL_SETTINGS.smtpHost,
        smtpPort: USER_DEFAULT_MAIL_SETTINGS.smtpPort,
        smtpUser: USER_DEFAULT_MAIL_SETTINGS.smtpUser,
        smtpPass: USER_DEFAULT_MAIL_SETTINGS.smtpPass,
        smtpFrom: USER_DEFAULT_MAIL_SETTINGS.smtpFrom,
        imapHost: USER_DEFAULT_MAIL_SETTINGS.imapHost,
        imapPort: USER_DEFAULT_MAIL_SETTINGS.imapPort,
        imapUser: USER_DEFAULT_MAIL_SETTINGS.imapUser,
        imapPass: USER_DEFAULT_MAIL_SETTINGS.imapPass,
        testRecipient: USER_DEFAULT_MAIL_SETTINGS.testRecipient,
        previewMode: USER_DEFAULT_MAIL_SETTINGS.previewMode,
      },
    }));
    setStatus('Your default mail settings applied. Save settings to persist.');
  }

  async function runManualSync(): Promise<void> {
    if (!settings) {
      return;
    }

    const calendarId = selectedCalendarId || calendars[0]?.id;
    const ownerMemberId = selectedMemberId || members[0]?.id;
    if (!calendarId || !ownerMemberId) {
      setStatus('Choose a member and calendar first');
      return;
    }

    const response = await fetch(apiUrl('/api/v1/sync/run'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: settings.sync.provider,
        calendarId,
        ownerMemberId,
        rawContent: settings.mail.inboxSource || sampleIcs,
      }),
    });

    const result = (await response.json()) as { message?: string };
    setStatus(result.message ?? (response.ok ? 'Sync completed' : 'Sync failed'));
    await loadDashboard();
    await loadSettings();
  }

  async function addMember(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!newMemberName.trim()) {
      setStatus('Member name is required');
      return;
    }

    const response = await fetch(apiUrl('/api/v1/members'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newMemberName.trim(),
        role: newMemberRole,
        email: newMemberEmail.trim() || undefined,
      }),
    });

    if (!response.ok) {
      setStatus('Could not add member');
      return;
    }

    setNewMemberName('');
    setNewMemberEmail('');
    setStatus('Member added');
    await loadDashboard();
  }

  async function saveMember(memberId: string): Promise<void> {
    const edit = memberEdits[memberId];
    if (!edit) {
      return;
    }

    const response = await fetch(apiUrl(`/api/v1/members/${memberId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: edit.name.trim(),
        role: edit.role,
        email: edit.email.trim() || '',
      }),
    });

    if (!response.ok) {
      setStatus('Could not update member');
      return;
    }

    setStatus('Member updated');
    await loadDashboard();
  }

  async function saveEditedEntry(): Promise<void> {
    if (!editingEntry) {
      return;
    }

    const response = await fetch(apiUrl(`/api/v1/entries/${editingEntry.id}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editingEntry.title,
        status: editingEntry.status,
        startTime: new Date(editingEntry.startTime).toISOString(),
        endTime: new Date(editingEntry.endTime).toISOString(),
      }),
    });

    if (!response.ok) {
      setStatus('Could not update entry');
      return;
    }

    setStatus('Entry updated');
    setEditingEntry(null);
    await loadDashboard();
  }

  async function deleteEditedEntry(): Promise<void> {
    if (!editingEntry) {
      return;
    }

    const confirmed = window.confirm('Delete this entry?');
    if (!confirmed) {
      return;
    }

    const response = await fetch(apiUrl(`/api/v1/entries/${editingEntry.id}`), {
      method: 'DELETE',
    });

    if (!response.ok) {
      setStatus('Could not delete entry');
      return;
    }

    setStatus('Entry deleted');
    setEditingEntry(null);
    await loadDashboard();
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">MentalLoad</p>
          <h1>Family weekly planner</h1>
          <p className="subtle">Agenda-first planning with editable events, auto-hide quick tools, weather rows, and a weekly family food plan.</p>
        </div>
        <div className="hero-meta">
          <div className="status-pill">{status}</div>
          <div className="info-pill">Scheduled reminders: {reminderJobs}</div>
          <div className="button-row view-switcher">
            <button type="button" className={currentView === 'planner' ? 'nav-button active' : 'nav-button'} onClick={() => setCurrentView('planner')}>
              Planner
            </button>
            <button type="button" className={currentView === 'settings' ? 'nav-button active' : 'nav-button'} onClick={() => setCurrentView('settings')}>
              Settings
            </button>
          </div>
        </div>
      </header>

      {currentView === 'planner' ? (
        <main className="planner-layout">
          <section className="panel month-panel">
            <div className="panel-header compact">
              <h2>Month</h2>
              <span>{monthDays[0] ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(`${monthDays[0].dateKey}T12:00:00`)) : ''}</span>
            </div>
            <div className="month-days" aria-label="Month overview with appointments">
              {monthDays.map((day, idx) => {
                const allDayEntries = entriesByDate[day.dateKey] ?? [];
                const dayEvents = allDayEntries.filter((e) => e.type !== 'task');
                return (
                  <Fragment key={day.dateKey}>
                  {day.monthLabel && idx > 0 ? (
                    <div className="month-divider"><span>{day.monthLabel}</span></div>
                  ) : null}
                  <article
                    className={day.dateKey === todayDateKey ? 'month-day today clickable-day' : 'month-day clickable-day'}
                    role="button"
                    tabIndex={0}
                    onClick={() => openCreateEventModal(day.dateKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openCreateEventModal(day.dateKey);
                      }
                    }}
                  >
                    <div className="month-day-header">
                      <strong>{day.dayNumber}</strong>
                      <small>{day.weekdayShort}</small>
                    </div>
                    <div className="month-pills">
                      {dayEvents.slice(0, 4).map((entry) => {
                        const owner = memberById[entry.ownerMemberId];
                        const isBirthday = isBirthdayTitle(entry.title);
                        const hasPending = entryIdsWithPendingTasks.has(entry.id);
                        const allDone = entryIdsWithAllTasksDone.has(entry.id);
                        const pillLabel = isBirthday ? extractBirthdayName(entry.title) : (owner?.name ?? '?');
                        const pillColor = isBirthday ? '#c7362f' : (memberColorById[entry.ownerMemberId] ?? '#8fa1b7');
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            className={isBirthday ? 'month-pill birthday-pill' : 'month-pill'}
                            title={entry.title}
                            onClick={(event) => {
                              event.stopPropagation();
                              openExistingEventModal(entry);
                            }}
                            style={{ '--pill-color': pillColor } as CSSProperties}
                          >
                            {isBirthday ? <span className="fi fi-dk birthday-pill-flag" aria-hidden="true" /> : null}
                            <span className="pill-name">{pillLabel}</span>
                            {!isBirthday && hasPending ? <span className="pill-task-icon pending" title="Unfinished tasks">📝</span> : null}
                            {!isBirthday && allDone ? <span className="pill-task-icon done" title="All tasks done">✓</span> : null}
                          </button>
                        );
                      })}
                      {dayEvents.length > 4 ? <small className="more">+{dayEvents.length - 4} more</small> : null}
                    </div>
                  </article>
                  </Fragment>
                );
              })}
            </div>
          </section>

          <section className="panel agenda-panel">
            <div className="panel-header compact">
              <h2>Agenda</h2>
              <span>{activeMember ? `Active member: ${activeMember.name}` : 'Choose a member'}</span>
            </div>

            <div
              className="agenda-grid"
              role="table"
              aria-label="Family agenda"
              style={{ '--member-columns': `${Math.max(members.length, 1)}` } as CSSProperties}
            >
              <button type="button" className="agenda-head cell day-header-button" onClick={() => openCreateEventModal(todayDateKey)}>
                Day
              </button>
              {members.map((member) => (
                <div key={member.id} className="agenda-head cell" style={{ borderTopColor: memberColorById[member.id] ?? '#8fa1b7' }}>
                  {member.name}
                </div>
              ))}

              {agendaDays.map((day) => (
                <Fragment key={day.dateKey}>
                  <button key={`${day.dateKey}-label`} type="button" className="agenda-day-label cell clickable-day" onClick={() => openCreateEventModal(day.dateKey)}>
                    <strong>{day.label}</strong>
                    <small>
                      {weatherByDate[day.dateKey]
                        ? `${weatherByDate[day.dateKey].icon} ${weatherByDate[day.dateKey].label}${typeof weatherByDate[day.dateKey].temperatureC === 'number' ? `, ${weatherByDate[day.dateKey].temperatureC}C` : ''}`
                        : 'Weather loading...'}
                    </small>
                  </button>
                  {members.map((member) => {
                    const dayEntries = (entriesByDateAndMember[`${day.dateKey}|${member.id}`] ?? [])
                      .filter((e) => e.type !== 'task' && !isBirthdayTitle(e.title));
                    return (
                      <div key={`${day.dateKey}-${member.id}`} className="agenda-cell cell clickable-day" onClick={() => openCreateEventModal(day.dateKey, member.id)}>
                        {dayEntries.map((entry) => {
                          const isBirthday = isBirthdayTitle(entry.title);
                          return (
                            <button
                              key={entry.id}
                              type="button"
                              className="agenda-entry"
                              onClick={(event) => {
                                event.stopPropagation();
                                openExistingEventModal(entry);
                              }}
                            >
                              <span className="agenda-entry-title">
                                <strong>{isBirthday ? normalizeBirthdayTitle(entry.title) : entry.title}</strong>
                                {entryIdsWithTasks.has(entry.id) ? <span className="task-dot" title="Has tasks">✓</span> : null}
                              </span>
                              {!isBirthday ? <small>{formatDisplay(entry.startTime)}</small> : null}
                            </button>
                          );
                        })}
                        {dayEntries.length === 0 ? <span className="empty">No events</span> : null}
                      </div>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          </section>

          <section className="planner-bottom">
            <section className="panel food-panel">
              <div className="panel-header compact">
                <h2>Food Plan</h2>
                <span>Click a day to edit dish and groceries</span>
              </div>
              <div className="food-square-grid">
                {FOOD_DAYS.map((day) => {
                  const item = foodPlan[day];
                  return (
                    <button key={day} type="button" className={item?.dishName ? 'food-square has-dish' : 'food-square'} onClick={() => openFoodDayModal(day)}>
                      <span className="food-square-day">{capitalize(day).slice(0, 3)}</span>
                      <span className="food-square-dish">{item?.dishName || '—'}</span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="panel tasks-panel">
              <div className="panel-header compact">
                <h2>Today&apos;s tasks</h2>
                <span>{todaysTasks.length} item(s)</span>
              </div>
              <div className="today-task-list">
                {todaysTasks.map((entry) => {
                  const owner = memberById[entry.ownerMemberId];
                  return (
                    <div key={entry.id} className="today-task">
                      <label className="today-task-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={entry.status === 'completed'}
                          onChange={(e) => void toggleTaskComplete(entry.id, e.target.checked)}
                        />
                      </label>
                      <button type="button" className={entry.status === 'completed' ? 'today-task-body done' : 'today-task-body'} onClick={() => openExistingEventModal(entry)}>
                        <strong>{entry.title}</strong>
                        <small>{formatDisplay(entry.startTime)}</small>
                      </button>
                      <span className="task-owner" style={{ borderColor: memberColorById[entry.ownerMemberId] ?? '#8fa1b7' }}>
                        {owner?.name ?? 'Unknown'}
                      </span>
                    </div>
                  );
                })}
                {todaysTasks.length === 0 ? <p className="empty">No tasks today.</p> : null}
              </div>
            </section>
          </section>

          {editingEntry ? (
            <section className="panel edit-panel">
              <h3>Edit event</h3>
              <label>
                Title
                <input value={editingEntry.title} onChange={(event) => setEditingEntry((current) => (current ? { ...current, title: event.target.value } : current))} />
              </label>
              <div className="two-col">
                <label>
                  Start
                  <input type="datetime-local" value={editingEntry.startTime} onChange={(event) => setEditingEntry((current) => (current ? { ...current, startTime: event.target.value } : current))} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={editingEntry.endTime} onChange={(event) => setEditingEntry((current) => (current ? { ...current, endTime: event.target.value } : current))} />
                </label>
              </div>
              <label>
                Status
                <select value={editingEntry.status} onChange={(event) => setEditingEntry((current) => (current ? { ...current, status: event.target.value as Entry['status'] } : current))}>
                  <option value="active">Active</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <div className="button-row">
                <button type="button" onClick={() => void saveEditedEntry()}>Save changes</button>
                <button type="button" className="secondary-action" onClick={() => setEditingEntry(null)}>Cancel</button>
                <button type="button" className="danger-action" onClick={() => void deleteEditedEntry()}>Delete</button>
              </div>
            </section>
          ) : null}
        </main>
      ) : (
        <main className="settings-layout">
          <section className="panel settings-shell">
            <div className="panel-header">
              <div>
                <h2>Settings hub</h2>
                <p className="subtle">Manage members, mailbox ingestion, SMTP/Mailpit, themes, Ollama, birthdays, and parameters.</p>
              </div>
            </div>

            <div className="settings-grid">
              <div className="tab-list" role="tablist" aria-label="Settings sections">
                {['members', 'mailpit', 'weather', 'sync', 'theme', 'birthdays', 'recurring', 'ai', 'general'].map((tab) => {
                  const labelMap: Record<string, string> = {
                    members: 'Members',
                    mailpit: 'Email transport',
                    weather: 'Weather',
                    sync: 'Calendar sync',
                    theme: 'Theme',
                    birthdays: 'Birthdays',
                    recurring: 'Recurring events',
                    ai: 'AI playground',
                    general: 'General',
                  };

                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={activeSettingsTab === tab}
                      className={activeSettingsTab === tab ? 'tab-button active' : 'tab-button'}
                      onClick={() => setActiveSettingsTab(tab as SettingsTab)}
                    >
                      {labelMap[tab]}
                    </button>
                  );
                })}
              </div>

              <div className="tab-panel">
                {activeSettingsTab === 'members' ? (
                  <section className="settings-section">
                    <h3>Manage members and linked inboxes</h3>
                    <p className="subtle">Each member can have an inbox email used for incoming invites that should become calendar events.</p>
                    <div className="member-list">
                      {members.map((member) => {
                        const edit = memberEdits[member.id];
                        return (
                          <div key={member.id} className="summary-card member-edit-card">
                            <label>
                              Name
                              <input value={edit?.name ?? member.name} onChange={(event) => setMemberEdits((current) => ({
                                ...current,
                                [member.id]: {
                                  ...(current[member.id] ?? { name: member.name, role: member.role, email: member.email ?? '' }),
                                  name: event.target.value,
                                },
                              }))} />
                            </label>
                            <label>
                              Role
                              <select value={edit?.role ?? member.role} onChange={(event) => setMemberEdits((current) => ({
                                ...current,
                                [member.id]: {
                                  ...(current[member.id] ?? { name: member.name, role: member.role, email: member.email ?? '' }),
                                  role: event.target.value as Member['role'],
                                },
                              }))}>
                                <option value="child">Child</option>
                                <option value="parent">Parent</option>
                              </select>
                            </label>
                            <label>
                              Linked email inbox
                              <input value={edit?.email ?? member.email ?? ''} onChange={(event) => setMemberEdits((current) => ({
                                ...current,
                                [member.id]: {
                                  ...(current[member.id] ?? { name: member.name, role: member.role, email: member.email ?? '' }),
                                  email: event.target.value,
                                },
                              }))} />
                            </label>
                            <button type="button" onClick={() => void saveMember(member.id)}>Save member</button>
                          </div>
                        );
                      })}
                    </div>

                    <form className="form inline-form" onSubmit={(event) => void addMember(event)}>
                      <div className="three-col">
                        <label>
                          New member name
                          <input value={newMemberName} onChange={(event) => setNewMemberName(event.target.value)} />
                        </label>
                        <label>
                          Member role
                          <select value={newMemberRole} onChange={(event) => setNewMemberRole(event.target.value as Member['role'])}>
                            <option value="child">Child</option>
                            <option value="parent">Parent</option>
                          </select>
                        </label>
                        <label>
                          Linked email inbox
                          <input value={newMemberEmail} onChange={(event) => setNewMemberEmail(event.target.value)} placeholder="name@family.test" />
                        </label>
                      </div>
                      <button type="submit">Add member</button>
                    </form>
                  </section>
                ) : null}

                {activeSettingsTab === 'mailpit' && settings ? (
                  <section className="settings-section">
                    <h3>Email transport (SMTP & IMAP)</h3>
                    <p className="subtle">
                      <strong>SMTP</strong> (sending): Delivers event invites, reminders, and test emails. For local dev, use Mailpit SMTP (mailpit:1025). 
                      <strong>IMAP</strong> (receiving): Pulls emails from your inbox into Mailpit for syncing events. Leave empty for local dev.
                      Mailpit web UI is at http://localhost:8025.
                    </p>

                    <div className="summary-card">
                      <strong>Mailpit inbox bridge</strong>
                      <p className="subtle">Pull your real inbox into Mailpit manually, or let the backend auto-pull on a timer.</p>
                      <div className="three-col">
                        <label>
                          Auto pull
                          <select
                            value={isMailpitAutoPullEnabled() ? 'enabled' : 'disabled'}
                            onChange={(event) => updateLocalSettings((current) => ({
                              ...current,
                              sync: {
                                ...current.sync,
                                configJson: {
                                  ...current.sync.configJson,
                                  mailpitAutoPullEnabled: event.target.value === 'enabled',
                                },
                              },
                            }))}
                          >
                            <option value="enabled">Enabled</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </label>
                        <label>
                          Pull every minute(s)
                          <input
                            type="number"
                            min={1}
                            value={getMailpitPullMinutes()}
                            onChange={(event) => updateLocalSettings((current) => ({
                              ...current,
                              sync: {
                                ...current.sync,
                                configJson: {
                                  ...current.sync.configJson,
                                  mailpitPullMinutes: Math.max(1, Number(event.target.value) || 1),
                                },
                              },
                            }))}
                          />
                        </label>
                        <label>
                          Mailpit UI
                          <a className="secondary-button" href="http://localhost:8025" target="_blank" rel="noreferrer">Open Mailpit</a>
                        </label>
                      </div>
                      <div className="button-row">
                        <button type="button" onClick={() => void pullInboxToMailpit()}>Pull inbox now</button>
                        <button type="button" className="secondary-action" onClick={() => void saveSettings()}>Save Mailpit schedule</button>
                      </div>
                    </div>

                    <div className="button-row">
                      <button type="button" onClick={applyMailpitDefaults}>Use Mailpit defaults</button>
                      <button type="button" className="secondary-action" onClick={applyMyDefaults}>Use my defaults</button>
                    </div>

                    <div className="three-col">
                      <label>
                        SMTP host
                        <input value={settings.mail.smtpHost} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpHost: event.target.value } }))} />
                      </label>
                      <label>
                        SMTP port
                        <input type="number" value={settings.mail.smtpPort} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) || 0 } }))} />
                      </label>
                      <label>
                        SMTP from
                        <input value={settings.mail.smtpFrom} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpFrom: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="three-col">
                      <label>
                        SMTP user
                        <input value={settings.mail.smtpUser} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpUser: event.target.value } }))} />
                      </label>
                      <label>
                        SMTP password
                        <input type="password" value={settings.mail.smtpPass} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpPass: event.target.value } }))} />
                      </label>
                      <label>
                        Test recipient
                        <input value={settings.mail.testRecipient} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, testRecipient: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="three-col">
                      <label>
                        IMAP host
                        <input value={settings.mail.imapHost} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapHost: event.target.value } }))} />
                      </label>
                      <label>
                        IMAP port
                        <input type="number" value={settings.mail.imapPort} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapPort: Number(event.target.value) || 0 } }))} />
                      </label>
                      <label>
                        Preview mode
                        <select
                          value={settings.mail.previewMode ? 'enabled' : 'disabled'}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            mail: {
                              ...current.mail,
                              previewMode: event.target.value === 'enabled',
                            },
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                    </div>

                    <div className="two-col">
                      <label>
                        IMAP user
                        <input value={settings.mail.imapUser} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapUser: event.target.value } }))} />
                      </label>
                      <label>
                        IMAP password
                        <input type="password" value={settings.mail.imapPass} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapPass: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="button-row">
                      <button type="button" onClick={() => void saveSettings()}>Save settings</button>
                      <button type="button" className="secondary-action" onClick={() => void sendTestEmail()}>Send test email</button>
                      <button type="button" className="secondary-action" onClick={() => void testEventWithIcsInvite()}>Test event + ICS invite</button>
                      <button type="button" className="secondary-action" onClick={() => void pullInboxToMailpit()}>Pull inbox to Mailpit</button>
                    </div>
                  </section>
                ) : null}

                {activeSettingsTab === 'weather' && settings ? (
                  <section className="settings-section">
                    <h3>Weather configuration</h3>
                    <p className="subtle">Type a town and auto-fill coordinates for agenda forecasts.</p>

                    <div className="two-col">
                      <label>
                        Town
                        <input
                          value={String(settings.sync.configJson.weatherLocationName ?? 'Copenhagen')}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            sync: {
                              ...current.sync,
                              configJson: {
                                ...current.sync.configJson,
                                weatherLocationName: event.target.value,
                              },
                            },
                          }))}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              void resolveWeatherTown(event.currentTarget.value);
                            }
                          }}
                        />
                      </label>
                      <label>
                        Forecast days
                        <input
                          type="number"
                          min={3}
                          max={14}
                          value={Number(settings.sync.configJson.weatherForecastDays ?? 7)}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            sync: {
                              ...current.sync,
                              configJson: {
                                ...current.sync.configJson,
                                weatherForecastDays: Math.max(3, Math.min(14, Number(event.target.value) || 7)),
                              },
                            },
                          }))}
                        />
                      </label>
                    </div>

                    <div className="two-col">
                      <label>
                        Latitude
                        <input type="number" step="0.0001" value={Number(settings.sync.configJson.weatherLatitude ?? 55.6761)} readOnly />
                      </label>
                      <label>
                        Longitude
                        <input type="number" step="0.0001" value={Number(settings.sync.configJson.weatherLongitude ?? 12.5683)} readOnly />
                      </label>
                    </div>

                    {weatherLookupNote ? <p className="subtle">{weatherLookupNote}</p> : null}

                    <div className="button-row">
                      <button type="button" onClick={() => void resolveWeatherTown()} disabled={weatherLookupBusy}>
                        {weatherLookupBusy ? 'Finding...' : 'Find coordinates'}
                      </button>
                      <button type="button" onClick={() => void saveSettings()}>Save weather</button>
                      <button type="button" className="secondary-action" onClick={() => void loadWeather(settings)}>Refresh weather now</button>
                    </div>
                  </section>
                ) : null}

                {activeSettingsTab === 'sync' && settings ? (
                  <section className="settings-section">
                    <h3>Calendar sync (independent of email transport)</h3>
                    <p className="subtle">
                      Sync pulls calendar events from external sources. <strong>None</strong> = only local events. 
                      <strong>Google/Apple/Outlook</strong> = OAuth connect to external calendar. 
                      <strong>Invite-mail</strong> = pulls calendar invites from your email inbox (requires IMAP configured in Email transport tab).
                      This is separate from email delivery (SMTP) which sends invites.
                    </p>
                    <div className="three-col">
                      <label>
                        SMTP host
                        <input value={settings.mail.smtpHost} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpHost: event.target.value } }))} />
                      </label>
                      <label>
                        SMTP port
                        <input type="number" value={settings.mail.smtpPort} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) || 0 } }))} />
                      </label>
                      <label>
                        SMTP from
                        <input value={settings.mail.smtpFrom} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpFrom: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="three-col">
                      <label>
                        SMTP user
                        <input value={settings.mail.smtpUser} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpUser: event.target.value } }))} />
                      </label>
                      <label>
                        SMTP password
                        <input type="password" value={settings.mail.smtpPass} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, smtpPass: event.target.value } }))} />
                      </label>
                      <label>
                        Test recipient
                        <input value={settings.mail.testRecipient} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, testRecipient: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="three-col">
                      <label>
                        IMAP host
                        <input value={settings.mail.imapHost} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapHost: event.target.value } }))} />
                      </label>
                      <label>
                        IMAP port
                        <input type="number" value={settings.mail.imapPort} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapPort: Number(event.target.value) || 0 } }))} />
                      </label>
                      <label>
                        IMAP user
                        <input value={settings.mail.imapUser} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapUser: event.target.value } }))} />
                      </label>
                    </div>

                    <div className="two-col">
                      <label>
                        IMAP password
                        <input type="password" value={settings.mail.imapPass} onChange={(event) => updateLocalSettings((current) => ({ ...current, mail: { ...current.mail, imapPass: event.target.value } }))} />
                      </label>
                      <label>
                        Sync provider
                        <select
                          aria-label="Sync provider"
                          value={settings.sync.provider}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            sync: {
                              ...current.sync,
                              provider: event.target.value as AppSettings['sync']['provider'],
                              isConnected: event.target.value === 'none',
                            },
                          }))}
                        >
                          <option value="none">None</option>
                          <option value="invite-mail">Invite mail</option>
                          <option value="apple">Apple</option>
                          <option value="google">Google</option>
                          <option value="outlook">Outlook</option>
                        </select>
                      </label>
                    </div>

                    <label>
                      Incoming mail source (raw email or ICS source)
                      <textarea
                        aria-label="Sync source"
                        value={settings.mail.inboxSource ?? ''}
                        onChange={(event) => updateLocalSettings((current) => ({
                          ...current,
                          mail: {
                            ...current.mail,
                            inboxSource: event.target.value,
                          },
                          sync: {
                            ...current.sync,
                            configJson: {
                              ...current.sync.configJson,
                              inboxSource: event.target.value,
                            },
                          },
                        }))}
                        rows={8}
                      />
                    </label>

                    <div className="button-row">
                      <button type="button" onClick={() => void connectSync()}>Connect sync</button>
                      <button type="button" className="secondary-action" onClick={() => void sendTestEmail()}>Send test email</button>
                      <button type="button" className="secondary-action" onClick={() => void runManualSync()}>Run manual sync</button>
                      <button type="button" className="secondary-action" onClick={() => void saveSettings()}>Save settings</button>
                    </div>

                    <small>
                      Provider status: {settings.sync.isConnected ? 'connected' : 'not connected'}
                      {settings.sync.lastSyncAt ? ` - Last sync ${formatShortDate(settings.sync.lastSyncAt)}` : ''}
                    </small>
                  </section>
                ) : null}

                {activeSettingsTab === 'theme' && settings ? (
                  <section className="settings-section">
                    <h3>Manage themes</h3>
                    <label>
                      Interface style
                      <select
                        aria-label="Interface style"
                        value={settings.theme.appearance ?? 'classic'}
                        onChange={(event) => updateLocalSettings((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            appearance: event.target.value as ThemeAppearance,
                          },
                        }))}
                      >
                        <option value="classic">Classic</option>
                        <option value="glass">Glass dashboard</option>
                      </select>
                    </label>
                    <label>
                      Theme mode
                      <select
                        aria-label="Theme mode"
                        value={settings.theme.mode}
                        onChange={(event) => updateLocalSettings((current) => ({
                          ...current,
                          theme: {
                            ...current.theme,
                            mode: event.target.value as AppSettings['theme']['mode'],
                          },
                        }))}
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => void saveSettings()}>Save settings</button>
                  </section>
                ) : null}

                {activeSettingsTab === 'birthdays' ? (
                  <section className="settings-section">
                    <h3>Manage birthdays</h3>
                    <form className="form inline-form" onSubmit={(event) => void saveBirthday(event)}>
                      <div className="two-col">
                        <label>
                          Birthday name
                          <input aria-label="Birthday name" value={birthdayName} onChange={(event) => setBirthdayName(event.target.value)} />
                        </label>
                        <label>
                          Birthday date
                          <input aria-label="Birthday date" type="date" value={birthdayDate} onChange={(event) => setBirthdayDate(event.target.value)} />
                        </label>
                      </div>
                      <button type="submit">Save birthday</button>
                    </form>

                    <div className="member-list">
                      {birthdayEntries.length > 0 ? birthdayEntries.map((entry) => (
                        <div key={entry.id} className="summary-card">
                          <strong>{normalizeBirthdayTitle(entry.title)}</strong>
                          <div className="button-row">
                            <button type="button" className="danger-action" onClick={() => void deleteBirthday(entry.id)}>Delete</button>
                          </div>
                        </div>
                      )) : <p className="empty">No birthdays saved yet</p>}
                    </div>
                  </section>
                ) : null}

                {activeSettingsTab === 'recurring' ? (
                  <section className="settings-section">
                    <h3>Recurring events</h3>
                    <p className="subtle">Create repeating weekly events from Settings. Example: Emil, Soccer training, every Wednesday from 17:30 to 19:30.</p>

                    <form className="form inline-form" onSubmit={(event) => void saveRecurringEvent(event)}>
                      <div className="two-col">
                        <label>
                          Event title
                          <input aria-label="Recurring event title" value={recurringTitle} onChange={(event) => setRecurringTitle(event.target.value)} />
                        </label>
                        <label>
                          Member
                          <select aria-label="Recurring event member" value={recurringMemberId || selectedMemberId || members[0]?.id || ''} onChange={(event) => setRecurringMemberId(event.target.value)}>
                            {members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                          </select>
                        </label>
                      </div>

                      <div className="three-col">
                        <label>
                          Calendar
                          <select aria-label="Recurring event calendar" value={recurringCalendarId || selectedCalendarId || calendars[0]?.id || ''} onChange={(event) => setRecurringCalendarId(event.target.value)}>
                            {calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                          </select>
                        </label>
                        <label>
                          Weekday
                          <select aria-label="Recurring event weekday" value={recurringWeekday} onChange={(event) => setRecurringWeekday(event.target.value as RecurringWeekday)}>
                            <option value="monday">Monday</option>
                            <option value="tuesday">Tuesday</option>
                            <option value="wednesday">Wednesday</option>
                            <option value="thursday">Thursday</option>
                            <option value="friday">Friday</option>
                            <option value="saturday">Saturday</option>
                            <option value="sunday">Sunday</option>
                          </select>
                        </label>
                        <label>
                          Starts next
                          <input value={formatLongDate(nextRecurringOccurrence(recurringWeekday))} readOnly />
                        </label>
                      </div>

                      <div className="two-col">
                        <label>
                          Start time
                          <input aria-label="Recurring event start time" type="time" value={recurringStartClock} onChange={(event) => setRecurringStartClock(event.target.value)} />
                        </label>
                        <label>
                          End time
                          <input aria-label="Recurring event end time" type="time" value={recurringEndClock} onChange={(event) => setRecurringEndClock(event.target.value)} />
                        </label>
                      </div>

                      <div className="button-row">
                        <button type="submit">Save recurring event</button>
                      </div>
                    </form>
                  </section>
                ) : null}

                {activeSettingsTab === 'ai' && settings ? (
                  <section className="settings-section">
                    <h3>Manage Ollama and AI chat</h3>
                    <p className="subtle">Use the test button to verify that the backend can reach Ollama and that the configured model is installed.</p>
                    <div className="two-col">
                      <label>
                        Ollama URL
                        <input
                          value={settings.assistant.ollamaUrl ?? ''}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            assistant: {
                              ...current.assistant,
                              ollamaUrl: event.target.value,
                            },
                          }))}
                        />
                      </label>
                      <label>
                        Ollama model
                        <input
                          value={settings.assistant.modelName}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            assistant: {
                              ...current.assistant,
                              modelName: event.target.value,
                            },
                          }))}
                        />
                      </label>
                    </div>

                    <label>
                      Fun AI prompt
                      <textarea aria-label="Fun AI prompt" value={funPrompt} onChange={(event) => setFunPrompt(event.target.value)} rows={5} />
                    </label>
                    <div className="button-row">
                      <button type="button" onClick={() => void askFunAssistant()}>Ask AI</button>
                      <button type="button" className="secondary-action" onClick={() => void testOllamaConnection()}>Test Ollama</button>
                      <button type="button" className="secondary-action" onClick={() => void saveSettings()}>Save settings</button>
                    </div>
                    <div className="draft-card">
                      <strong>AI reply</strong>
                      <p>{funReply}</p>
                    </div>
                  </section>
                ) : null}

                {activeSettingsTab === 'general' && settings ? (
                  <section className="settings-section">
                    <h3>General parameters</h3>
                    <div className="two-col">
                      <label>
                        Language
                        <select
                          value={settings.assistant.language}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            assistant: {
                              ...current.assistant,
                              language: event.target.value as AppSettings['assistant']['language'],
                            },
                          }))}
                        >
                          <option value="en">English</option>
                          <option value="da">Dansk</option>
                        </select>
                      </label>
                      <label>
                        Preview mail mode
                        <select
                          value={settings.mail.previewMode ? 'enabled' : 'disabled'}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            mail: {
                              ...current.mail,
                              previewMode: event.target.value === 'enabled',
                            },
                          }))}
                        >
                          <option value="enabled">Enabled</option>
                          <option value="disabled">Disabled</option>
                        </select>
                      </label>
                    </div>
                    <button type="button" onClick={() => void saveSettings()}>Save settings</button>
                  </section>
                ) : null}
              </div>
            </div>
          </section>
        </main>
      )}

      {eventModalDraft ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Create event">
          <section className="modal-card">
            <div className="panel-header compact">
              <h3>{eventModalDraft.entryId ? 'Edit event' : 'Create event'} for {formatDateLabel(eventModalDraft.dateKey)}</h3>
              <button type="button" className="secondary-action" onClick={() => setEventModalDraft(null)}>Close</button>
            </div>

            <div className="form">
              <label>
                Title
                <input value={eventModalDraft.title} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, title: event.target.value } : current))} />
              </label>

              <div className="three-col">
                <label>
                  Member
                  <select value={eventModalDraft.ownerMemberId} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, ownerMemberId: event.target.value } : current))}>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Calendar
                  <select value={eventModalDraft.calendarId} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, calendarId: event.target.value } : current))}>
                    {calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Type
                  <select value={eventModalDraft.type} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, type: event.target.value as Entry['type'] } : current))}>
                    <option value="event">Event</option>
                    <option value="task">Task</option>
                  </select>
                </label>
              </div>

              <div className="two-col">
                <label>
                  Start
                  <input type="datetime-local" value={eventModalDraft.startTime} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, startTime: event.target.value } : current))} />
                </label>
                <label>
                  End
                  <input type="datetime-local" value={eventModalDraft.endTime} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, endTime: event.target.value } : current))} />
                </label>
              </div>

              <label className="checkbox-row">
                <input type="checkbox" checked={eventModalDraft.allDay} onChange={(event) => setEventModalDraft((current) => (current ? { ...current, allDay: event.target.checked } : current))} />
                All day
              </label>
              <label>
                Invite members
                <div className="invitee-grid">
                  {members
                    .filter((member) => member.id !== eventModalDraft.ownerMemberId && Boolean(member.email))
                    .map((member) => (
                      <label key={member.id} className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={eventModalDraft.inviteeMemberIds.includes(member.id)}
                          onChange={(event) => setEventModalDraft((current) => {
                            if (!current) {
                              return current;
                            }

                            const next = event.target.checked
                              ? [...current.inviteeMemberIds, member.id]
                              : current.inviteeMemberIds.filter((id) => id !== member.id);

                            return { ...current, inviteeMemberIds: next };
                          })}
                        />
                        {member.name} ({member.email})
                      </label>
                    ))}
                  {members.filter((member) => member.id !== eventModalDraft.ownerMemberId && Boolean(member.email)).length === 0 ? (
                    <small className="empty">No other members with email configured yet.</small>
                  ) : null}
                </div>
              </label>

              {eventModalDraft.existingTasks.length > 0 ? (
                <div className="existing-tasks-section">
                  <span className="label-text">Tasks</span>
                  {eventModalDraft.existingTasks.map((task) => (
                    <div key={task.id} className="task-item-row">
                      <label className="checkbox-row" style={{ flex: 1 }}>
                        <input
                          type="checkbox"
                          checked={task.status === 'completed'}
                          onChange={(event) => void toggleTaskComplete(task.id, event.target.checked)}
                        />
                        <span className={task.status === 'completed' ? 'task-title done' : 'task-title'}>{task.title}</span>
                      </label>
                      <button type="button" className="danger-action task-delete-btn" onClick={() => void deleteExistingTask(task.id)} title="Remove task">✕</button>
                    </div>
                  ))}
                </div>
              ) : null}
              <label>
                Add tasks (one per line)
                <textarea
                  rows={3}
                  placeholder="Type tasks here, one per line…"
                  value={eventModalDraft.taskLines}
                  onChange={(event) => setEventModalDraft((current) => (current ? { ...current, taskLines: event.target.value } : current))}
                />
              </label>

              <div className="button-row">
                <button type="button" onClick={() => void createEventFromModal()}>{eventModalDraft.entryId ? 'Save event' : 'Create event'}</button>
                <button type="button" className="secondary-action" onClick={() => setEventModalDraft(null)}>Cancel</button>
                {eventModalDraft.entryId ? <button type="button" className="danger-action" onClick={() => void deleteEventFromModal()}>Delete event</button> : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {foodModalDraft ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Edit food plan day">
          <section className="modal-card">
            <div className="panel-header compact">
              <h3>{capitalize(foodModalDraft.day)} meal</h3>
              <button type="button" className="secondary-action" onClick={() => setFoodModalDraft(null)}>Close</button>
            </div>

            <div className="form">
              <label>
                Dish name
                <input value={foodModalDraft.dishName} onChange={(event) => setFoodModalDraft((current) => (current ? { ...current, dishName: event.target.value } : current))} />
              </label>

              <label>
                Grocery list (one item per line)
                <textarea rows={5} value={foodModalDraft.groceryText} onChange={(event) => setFoodModalDraft((current) => (current ? { ...current, groceryText: event.target.value } : current))} />
              </label>

              <div className="summary-card">
                <strong>Dish proposals (LLM ready)</strong>
                <p className="subtle">Uses local assistant pipeline. You can later switch to a dedicated local LLM dish endpoint.</p>
                <div className="button-row">
                  <button type="button" className="secondary-action" onClick={() => void suggestFoodDishes()} disabled={foodModalDraft.loadingSuggestions}>
                    {foodModalDraft.loadingSuggestions ? 'Suggesting...' : 'Suggest dishes'}
                  </button>
                </div>
                {foodModalDraft.suggestions.length > 0 ? (
                  <div className="button-row">
                    {foodModalDraft.suggestions.map((suggestion) => (
                      <button key={suggestion} type="button" className="secondary-action" onClick={() => setFoodModalDraft((current) => (current ? { ...current, dishName: suggestion } : current))}>
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="button-row">
                <button type="button" onClick={() => void saveFoodModal()}>Save day</button>
                <button type="button" className="secondary-action" onClick={() => void clearFoodModal()}>Clear day</button>
                <button type="button" className="secondary-action" onClick={() => setFoodModalDraft(null)}>Cancel</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );

  async function saveBirthday(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const calendarId = selectedCalendarId || calendars[0]?.id;
    const ownerMemberId = selectedMemberId || members[0]?.id;
    if (!birthdayName.trim() || !birthdayDate || !calendarId || !ownerMemberId) {
      setStatus('Birthday name, date, member, and calendar are required');
      return;
    }

    const response = await fetch(apiUrl('/api/v1/entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `🇩🇰 ${birthdayName.trim()}`,
        type: 'event',
        ownerMemberId,
        calendarId,
        startTime: new Date(`${birthdayDate}T09:00:00`).toISOString(),
        endTime: new Date(`${birthdayDate}T10:00:00`).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: true,
        recurrenceRule: 'FREQ=YEARLY',
        reminders: [{ minutesBefore: 1440 }],
      }),
    });

    if (!response.ok) {
      setStatus('Could not save birthday');
      return;
    }

    setBirthdayName('');
    setStatus('Birthday saved');
    await loadDashboard();
  }

  async function saveRecurringEvent(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const ownerMemberId = recurringMemberId || selectedMemberId || members[0]?.id;
    const calendarId = recurringCalendarId || selectedCalendarId || calendars[0]?.id;
    if (!recurringTitle.trim() || !ownerMemberId || !calendarId || !recurringStartClock || !recurringEndClock) {
      setStatus('Recurring event title, member, calendar, and times are required');
      return;
    }

    const baseDate = nextRecurringOccurrence(recurringWeekday);
    const startDate = combineDateAndTime(baseDate, recurringStartClock);
    const endDate = combineDateAndTime(baseDate, recurringEndClock);
    if (endDate <= startDate) {
      setStatus('Recurring event end time must be after start time');
      return;
    }

    const response = await fetch(apiUrl('/api/v1/entries'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: recurringTitle.trim(),
        type: 'event',
        ownerMemberId,
        calendarId,
        startTime: startDate.toISOString(),
        endTime: endDate.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: false,
        recurrenceRule: 'FREQ=WEEKLY',
        reminders: [{ minutesBefore: 30 }],
      }),
    });

    if (!response.ok) {
      setStatus('Could not save recurring event');
      return;
    }

    setRecurringTitle('');
    setStatus('Recurring event saved');
    await loadDashboard();
  }
}

function createEmptyFoodEditor(): FoodEditorState {
  return {
    monday: { dishName: '', groceryText: '', open: false },
    tuesday: { dishName: '', groceryText: '', open: false },
    wednesday: { dishName: '', groceryText: '', open: false },
    thursday: { dishName: '', groceryText: '', open: false },
    friday: { dishName: '', groceryText: '', open: false },
    saturday: { dishName: '', groceryText: '', open: false },
    sunday: { dishName: '', groceryText: '', open: false },
  };
}

function nextRecurringOccurrence(weekday: RecurringWeekday): Date {
  const weekdayMap: Record<RecurringWeekday, number> = {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  };
  const now = new Date();
  const result = new Date(now);
  result.setHours(0, 0, 0, 0);
  const target = weekdayMap[weekday];
  const delta = (target - result.getDay() + 7) % 7 || 7;
  result.setDate(result.getDate() + delta);
  return result;
}

function combineDateAndTime(date: Date, timeValue: string): Date {
  const [hours, minutes] = timeValue.split(':').map((part) => Number(part));
  const next = new Date(date);
  next.setHours(hours || 0, minutes || 0, 0, 0);
  return next;
}

function formatLongDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function buildFoodEditor(foodPlan: Record<FoodPlanDay, FoodPlanItem | undefined>): FoodEditorState {
  const state = createEmptyFoodEditor();
  for (const day of FOOD_DAYS) {
    const item = foodPlan[day];
    state[day] = {
      ...state[day],
      dishName: item?.dishName ?? '',
      groceryText: item?.groceryList.join('\n') ?? '',
    };
  }
  return state;
}

function toMemberEditMap(members: Member[]): Record<string, EditableMember> {
  return members.reduce<Record<string, EditableMember>>((acc, member) => {
    acc[member.id] = {
      name: member.name,
      role: member.role,
      email: member.email ?? '',
    };
    return acc;
  }, {});
}

function buildAgendaDays(): Array<{ dateKey: string; label: string }> {
  const days: Array<{ dateKey: string; label: string }> = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  for (let index = 0; index < AGENDA_DAYS; index += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + index);
    days.push({
      dateKey: dateKeyFromDate(day),
      label: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(day),
    });
  }

  return days;
}

function currentWeekMonday(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  now.setDate(now.getDate() + diff);
  return dateKeyFromDate(now);
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function normalizeBirthdayTitle(title: string): string {
  const name = extractBirthdayName(title);
  return name ? `🇩🇰 ${name}` : '🇩🇰';
}

function extractBirthdayName(title: string): string {
  const raw = title.trim();
  const withoutFlag = raw.replace(/^🇩🇰\s*/u, '').trim();
  const withoutBirthdayWord = withoutFlag
    .replace(/\b(birthday|f[øo]dselsdag)\b\s*/giu, '')
    .trim();
  return withoutBirthdayWord || withoutFlag;
}

function isBirthdayTitle(title: string): boolean {
  return title.startsWith('🇩🇰') || /birthday|f[øo]dselsdag/i.test(title);
}

function toBaseEntryId(entryId: string): string {
  return entryId.split(':')[0];
}

function nextRoundedHour(): Date {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return now;
}

function toDateTimeLocal(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function formatDisplay(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function entryDateKey(value: string): string {
  return dateKeyFromDate(new Date(value));
}

function buildMonthDays(reference: Date): Array<{ dateKey: string; dayNumber: string; weekdayShort: string; monthLabel?: string }> {
  const items: Array<{ dateKey: string; dayNumber: string; weekdayShort: string; monthLabel?: string }> = [];
  const current = new Date(reference);
  current.setHours(0, 0, 0, 0);
  let lastMonth = -1;
  for (let i = 0; i < 60; i += 1) {
    const m = current.getMonth();
    const monthLabel: string | undefined = m !== lastMonth
      ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(current)
      : undefined;
    lastMonth = m;
    items.push({
      dateKey: dateKeyFromDate(current),
      dayNumber: `${current.getDate()}`,
      weekdayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(current),
      monthLabel,
    });
    current.setDate(current.getDate() + 1);
  }
  return items;
}

function dateKeyFromDate(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeWeatherDateKey(value: string): string {
  const match = value.match(/^\d{4}-\d{2}-\d{2}$/);
  if (match) {
    return value;
  }

  return dateKeyFromDate(new Date(value));
}

function buildDefaultTimesForDate(dateKey: string): { start: string; end: string } {
  const nextHour = nextRoundedHour();
  const [year, month, day] = dateKey.split('-').map((part) => Number(part));
  const startDate = new Date(year, (month || 1) - 1, day || 1, nextHour.getHours(), 0, 0, 0);
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

  return {
    start: toDateTimeLocal(startDate),
    end: toDateTimeLocal(endDate),
  };
}

function getWeatherConfig(settings: AppSettings | null | undefined): {
  locationName: string;
  latitude: number;
  longitude: number;
  forecastDays: number;
} {
  const locationName = String(settings?.sync.configJson.weatherLocationName ?? 'Copenhagen');
  const latitude = Number(settings?.sync.configJson.weatherLatitude ?? 55.6761);
  const longitude = Number(settings?.sync.configJson.weatherLongitude ?? 12.5683);
  const forecastDaysRaw = Number(settings?.sync.configJson.weatherForecastDays ?? 7);

  return {
    locationName,
    latitude: Number.isFinite(latitude) ? latitude : 55.6761,
    longitude: Number.isFinite(longitude) ? longitude : 12.5683,
    forecastDays: Number.isFinite(forecastDaysRaw) ? Math.max(3, Math.min(14, Math.floor(forecastDaysRaw))) : 7,
  };
}

function weatherIconForCode(code: number): string {
  if (code === 0) {
    return '☀️';
  }

  if (code === 1 || code === 2) {
    return '🌤️';
  }

  if (code === 3 || code === 45 || code === 48) {
    return '☁️';
  }

  if (code >= 51 && code <= 65) {
    return '🌧️';
  }

  if (code >= 71 && code <= 75) {
    return '❄️';
  }

  if (code >= 80 && code <= 82) {
    return '🌦️';
  }

  if (code >= 95) {
    return '⛈️';
  }

  return '🌡️';
}

function formatDateLabel(dateKey: string): string {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(`${dateKey}T00:00:00`));
}

function apiUrl(path: string): string {
  if (import.meta.env.DEV) {
    return path;
  }

  const configured = import.meta.env.VITE_BACKEND_URL;
  if (configured) {
    return `${configured}${path}`;
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:3000${path}`;
  }

  return path;
}

function webSocketUrl(path: string): string {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}${path}`;
  }

  const configured = import.meta.env.VITE_BACKEND_URL;
  if (configured) {
    return `${configured.replace(/^http/, 'ws')}${path}`;
  }

  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.hostname}:3000${path}`;
  }

  return path;
}
