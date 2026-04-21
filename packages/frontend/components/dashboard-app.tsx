'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit2,
  LoaderCircle,
  Plus,
  RefreshCcw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Users,
  Wifi,
  X,
} from 'lucide-react';
import type { AppSettings, AssistantDraft, Entry, FoodPlanDay, FoodPlanItem, Member, Calendar, MemberRole, SyncProvider } from '@mental-load/contracts';
import {
  askAssistant,
  connectSync,
  confirmAssistant,
  createMember,
  createEntry,
  deleteEntry,
  deleteFoodPlan,
  getWeekStart,
  loadAssistantStatus,
  loadDashboardSnapshot,
  loadFoodPlan,
  loadHealth,
  loadMembers,
  loadMonthOccurrences,
  loadSettings,
  loadWeatherForecast,
  loadUpcomingOccurrences,
  parseAssistant,
  pullInboxToMailpit,
  runSync,
  saveSettings,
  sendTestEmail,
  updateEntry,
  updateFoodPlan,
  updateMember,
  type WeatherForecastResponse,
} from '@/lib/api';
import { AgendaView } from '@/components/agenda-view';
import { cn } from '@/lib/utils';

type ReminderDraftMode = 'none' | '5' | '10' | '60' | '120' | '1440' | '2880' | 'custom';

type DashboardState = {
  members: Member[];
  calendars: Calendar[];
  entries: Entry[];
  reminderJobs: Array<{ id: string; runAt: string }>;
  persistence?: 'memory' | 'postgres';
};

type EventDraft = {
  title: string;
  type: Entry['type'];
  ownerMemberId: string;
  calendarId: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  recurrenceRule: string;
  tasks: string;
  reminder1Mode: ReminderDraftMode;
  reminder1CustomHours: string;
  reminder2Mode: ReminderDraftMode;
  reminder2CustomHours: string;
};

type FoodPlanDraft = {
  weekStart: string;
  day: FoodPlanDay;
  dishName: string;
  groceryInput: string;
};

type NavSection = 'dashboard' | 'planner' | 'family' | 'settings';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const MEMBER_COLOR_CLASSES = ['bg-primary', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'];
const REMINDER_OPTIONS: Array<{ value: Exclude<ReminderDraftMode, 'custom'>; label: string }> = [
  { value: 'none', label: 'No reminder' },
  { value: '5', label: '5 min before' },
  { value: '10', label: '10 min before' },
  { value: '60', label: '1 hour before' },
  { value: '120', label: '2 hours before' },
  { value: '1440', label: '1 day before' },
  { value: '2880', label: '2 days before' },
];

export function DashboardApp() {
  const router = useRouter();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardState>({ members: [], calendars: [], entries: [], reminderJobs: [] });
  const [monthOccurrences, setMonthOccurrences] = useState<Entry[]>([]);
  const [upcomingOccurrences, setUpcomingOccurrences] = useState<Entry[]>([]);
  const [foodPlan, setFoodPlan] = useState<FoodPlanItem[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [assistantMessage, setAssistantMessage] = useState('');
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [assistantResponse, setAssistantResponse] = useState('');
  const [assistantMissingFields, setAssistantMissingFields] = useState<string[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [healthNow, setHealthNow] = useState<string>('');
  const [assistantReady, setAssistantReady] = useState(false);
  const [assistantStatusText, setAssistantStatusText] = useState('Checking assistant...');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [deletingFoodPlan, setDeletingFoodPlan] = useState<{ weekStart: string; day: FoodPlanDay } | null>(null);
  const [foodPlanComposerOpen, setFoodPlanComposerOpen] = useState(false);
  const [foodPlanDraft, setFoodPlanDraft] = useState<FoodPlanDraft | null>(null);
  const [foodPlanEditingKey, setFoodPlanEditingKey] = useState<string | null>(null);
  const [foodPlanSaving, setFoodPlanSaving] = useState(false);
  const [assistantSuggestionBusy, setAssistantSuggestionBusy] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'members' | 'mail' | 'sync' | 'recurring' | 'birthdays' | 'weather'>('theme');
  const [memberDraft, setMemberDraft] = useState<{ name: string; role: MemberRole; email: string }>({ name: '', role: 'parent', email: '' });
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [mailActionBusy, setMailActionBusy] = useState(false);
  const [syncActionBusy, setSyncActionBusy] = useState(false);
  const [syncRunDraft, setSyncRunDraft] = useState({ calendarId: '', ownerMemberId: '', icsUrl: '', rawContent: '' });
  const [birthdaysDraft, setBirthdaysDraft] = useState<{ id?: string; name: string; date: string; memberId: string; notifyDaysBefore: number }>({ name: '', date: '', memberId: '', notifyDaysBefore: 7 });
  const [settingsMessage, setSettingsMessage] = useState('');
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => createDefaultDraft());

  useEffect(() => {
    let active = true;

    async function loadAll() {
      try {
        setErrorText('');
        setRefreshing(true);
        const [dashboardSnapshot, monthEntries, upcoming, weekFoodPlan, health, assistantStatus, settingsSnapshot] = await Promise.all([
          loadDashboardSnapshot(),
          loadMonthOccurrences(currentMonth),
          loadUpcomingOccurrences(30),
          loadFoodPlan(getWeekStart()),
          loadHealth(),
          loadAssistantStatus(),
          loadSettings(),
        ]);

        if (!active) {
          return;
        }

        setDashboard({
          members: dashboardSnapshot.members,
          calendars: dashboardSnapshot.calendars,
          entries: dashboardSnapshot.entries,
          reminderJobs: dashboardSnapshot.reminderJobs ?? [],
          persistence: dashboardSnapshot.persistence,
        });
        setMonthOccurrences(monthEntries);
        setUpcomingOccurrences(upcoming);
        setFoodPlan(weekFoodPlan.items);
        setHealthNow(health.now);
        setAssistantReady(assistantStatus.ok);
        setAssistantStatusText(assistantStatus.message);
        setSettings(settingsSnapshot);
        setSyncRunDraft((current) => ({
          ...current,
          calendarId: current.calendarId || dashboardSnapshot.calendars[0]?.id || '',
          ownerMemberId: current.ownerMemberId || dashboardSnapshot.members[0]?.id || '',
        }));
        setDraft((currentDraft) => hydrateDraft(currentDraft, dashboardSnapshot.members, dashboardSnapshot.calendars));
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : 'Could not load dashboard');
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    void loadAll();
    return () => {
      active = false;
    };
  }, [currentMonth]);

  useEffect(() => {
    applyTheme(settings?.theme.mode ?? 'dark');
    document.documentElement.dataset.appearance = settings?.theme.appearance ?? 'classic';
  }, [settings?.theme.appearance, settings?.theme.mode]);

  useEffect(() => {
    const wsUrl = resolveWebSocketUrl();
    if (!wsUrl) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string };
        if (payload.type && payload.type !== 'connected') {
          setCurrentMonth((current) => new Date(current));
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    return () => {
      socket.close();
    };
  }, []);

  const memberColorById = useMemo(() => {
    return dashboard.members.reduce<Record<string, string>>((accumulator, member, index) => {
      accumulator[member.id] = MEMBER_COLOR_CLASSES[index % MEMBER_COLOR_CLASSES.length];
      return accumulator;
    }, {});
  }, [dashboard.members]);

  const filteredUpcoming = useMemo(() => {
    return upcomingOccurrences
      .filter((entry) => entry.type !== 'task')
      .filter((entry) => matchesSearch(entry, dashboard.members, searchQuery))
      .sort((left, right) => left.startTime.localeCompare(right.startTime))
      .slice(0, 8);
  }, [dashboard.members, searchQuery, upcomingOccurrences]);

  const selectedEntries = useMemo(() => {
    return monthOccurrences
      .filter((entry) => sameDay(new Date(entry.startTime), selectedDate))
      .filter((entry) => matchesSearch(entry, dashboard.members, searchQuery))
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }, [dashboard.members, monthOccurrences, searchQuery, selectedDate]);

  const statCards = useMemo(() => {
    const today = new Date();
    const nextWeekBoundary = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    return [
      {
        label: 'Monthly events',
        value: String(monthOccurrences.filter((entry) => entry.type === 'event').length),
        subtext: `${MONTHS[currentMonth.getMonth()]} overview`,
        icon: CalendarDays,
        color: 'text-primary bg-primary/12',
      },
      {
        label: 'Family members',
        value: String(dashboard.members.length),
        subtext: 'Synced from backend',
        icon: Users,
        color: 'text-chart-2 bg-chart-2/12',
      },
      {
        label: 'Next 7 days',
        value: String(upcomingOccurrences.filter((entry) => new Date(entry.startTime) <= nextWeekBoundary).length),
        subtext: 'Recurring included',
        icon: Clock3,
        color: 'text-chart-3 bg-chart-3/12',
      },
      {
        label: 'Completed tasks',
        value: String(dashboard.entries.filter((entry) => entry.status === 'completed').length),
        subtext: 'Live task progress',
        icon: CheckCircle2,
        color: 'text-chart-5 bg-chart-5/12',
      },
    ];
  }, [currentMonth, dashboard.entries, dashboard.members.length, monthOccurrences, upcomingOccurrences]);

  const monthDays = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  const recurringEntries = useMemo(
    () => monthOccurrences.filter((entry) => Boolean(entry.recurrenceRule)).sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [monthOccurrences],
  );

  const birthdays = useMemo(() => parseBirthdays(settings?.sync.configJson.birthdays), [settings?.sync.configJson.birthdays]);

  const weatherConfig = useMemo<{ location: string; state: string; country: string; unit: 'C' | 'F'; updateFrequencyMinutes: number }>(() => {
    const raw = settings?.sync.configJson.weather;
    if (!raw || typeof raw !== 'object') {
      return { location: '', state: '', country: '', unit: 'C', updateFrequencyMinutes: 60 };
    }

    const location = typeof (raw as Record<string, unknown>).location === 'string' ? (raw as Record<string, string>).location : '';
    const state = typeof (raw as Record<string, unknown>).state === 'string' ? (raw as Record<string, string>).state : '';
    const country = typeof (raw as Record<string, unknown>).country === 'string' ? (raw as Record<string, string>).country : '';
    const unit = (raw as Record<string, unknown>).unit === 'F' ? 'F' : 'C';
    const updateFrequencyMinutes = Number((raw as Record<string, unknown>).updateFrequencyMinutes ?? 60);
    return {
      location,
      state,
      country,
      unit,
      updateFrequencyMinutes: Number.isFinite(updateFrequencyMinutes) && updateFrequencyMinutes > 0 ? updateFrequencyMinutes : 60,
    };
  }, [settings?.sync.configJson.weather]);

  const dayWeatherByDate = useMemo(() => {
    if (!weatherForecast) {
      return {} as Record<string, { temp: number; unitLabel: string; icon: string }>;
    }

    return weatherForecast.daily.reduce<Record<string, { temp: number; unitLabel: string; icon: string }>>((accumulator, item) => {
      accumulator[item.date] = {
        temp: Math.round(item.tempMax),
        unitLabel: weatherForecast.unit,
        icon: item.icon,
      };
      return accumulator;
    }, {});
  }, [weatherForecast]);

  useEffect(() => {
    let active = true;

    async function loadWeather() {
      if (!weatherConfig.location.trim()) {
        if (active) {
          setWeatherForecast(null);
        }
        return;
      }

      try {
        setWeatherLoading(true);
        const forecast = await loadWeatherForecast({
          location: weatherConfig.location,
          state: weatherConfig.state,
          country: weatherConfig.country,
          unit: weatherConfig.unit,
          days: 7,
        });

        if (!active) {
          return;
        }

        setWeatherForecast(forecast);
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText(error instanceof Error ? error.message : 'Could not load weather forecast');
      } finally {
        if (active) {
          setWeatherLoading(false);
        }
      }
    }

    void loadWeather();
    return () => {
      active = false;
    };
  }, [weatherConfig.country, weatherConfig.location, weatherConfig.state, weatherConfig.unit]);

  async function handleRefresh() {
    setCurrentMonth((current) => new Date(current));
  }

  async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reminders = buildReminderPayload(draft);
    if (reminders instanceof Error) {
      setErrorText(reminders.message);
      return;
    }

    try {
      setErrorText('');
      const payload = {
        title: draft.title.trim(),
        type: draft.type,
        ownerMemberId: draft.ownerMemberId,
        calendarId: draft.calendarId,
        startTime: new Date(draft.startTime).toISOString(),
        endTime: new Date(draft.endTime).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        allDay: draft.allDay,
        location: draft.location.trim() || undefined,
        recurrenceRule: draft.recurrenceRule.trim() || undefined,
        reminders,
        checklist: parseChecklistDraft(draft.tasks),
      };

      if (editingEntryId) {
        await updateEntry(editingEntryId, payload);
      } else {
        await createEntry(payload);
      }

      closeEntryComposer();
      await handleRefresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : `Could not ${editingEntryId ? 'update' : 'create'} entry`);
    }
  }

  async function handleAssistantParse() {
    if (!assistantMessage.trim()) {
      setErrorText('Assistant message is required');
      return;
    }

    try {
      setAssistantBusy(true);
      setErrorText('');
      const result = await parseAssistant({
        message: assistantMessage,
        memberId: draft.ownerMemberId || dashboard.members[0]?.id || '',
        calendarId: draft.calendarId || dashboard.calendars[0]?.id || '',
        language: settings?.assistant.language ?? 'en',
        existingDraft: assistantDraft ?? undefined,
      });
      setAssistantDraft(result.draft);
      setAssistantResponse(result.response);
      setAssistantMissingFields(result.missingFields);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Assistant parse failed');
    } finally {
      setAssistantBusy(false);
    }
  }

  async function handleAssistantConfirm() {
    if (!assistantDraft) {
      return;
    }

    try {
      setAssistantBusy(true);
      setErrorText('');
      const created = await confirmAssistant({ draft: assistantDraft });
      setAssistantResponse(`Created ${created.title}`);
      setAssistantDraft(null);
      setAssistantMissingFields([]);
      setAssistantMessage('');
      await handleRefresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Assistant confirm failed');
    } finally {
      setAssistantBusy(false);
    }
  }

  async function handleAssistantSuggestion() {
    const message = assistantMessage.trim();
    if (!message) {
      setErrorText('Write a prompt before asking for an AI suggestion');
      return;
    }

    try {
      setAssistantSuggestionBusy(true);
      setErrorText('');
      const result = await askAssistant({
        message,
        language: settings?.assistant.language ?? 'en',
      });
      setAssistantResponse(result.response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'AI suggestion failed');
    } finally {
      setAssistantSuggestionBusy(false);
    }
  }

  async function handleSaveSettings() {
    if (!settings) {
      return;
    }

    try {
      setSavingSettings(true);
      setErrorText('');
      const next = await saveSettings({
        theme: settings.theme,
        mail: settings.mail,
        sync: settings.sync,
        assistant: settings.assistant,
      });
      setSettings(next);
      setSettingsOpen(false);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save settings');
    } finally {
      setSavingSettings(false);
    }
  }

  function handleNavClick(section: NavSection) {
    setActiveNav(section);
    if (section === 'settings') {
      setSettingsOpen(true);
      return;
    }

    if (section === 'planner') {
      router.push('/planner');
      return;
    }

    if (section === 'family') {
      document.getElementById('family-section-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const targetId = section === 'dashboard' ? 'hero-section' : `${section}-section`;
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function handleDeleteEntry(entryId: string) {
    try {
      setErrorText('');
      setDeletingEntryId(entryId);
      await deleteEntry(entryId);
      await handleRefresh();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete entry');
    } finally {
      setDeletingEntryId(null);
    }
  }

  async function handleDeleteEntryFromComposer() {
    if (!editingEntryId) {
      return;
    }

    await handleDeleteEntry(editingEntryId);
    closeEntryComposer();
  }

  function handleEditEntry(entry: Entry) {
    setEditingEntryId(getEntryMutationId(entry));
    const [firstReminder, secondReminder] = entry.reminders;
    setDraft({
      title: entry.title,
      type: entry.type,
      ownerMemberId: entry.ownerMemberId,
      calendarId: entry.calendarId,
      startTime: toLocalInputValue(new Date(entry.startTime)),
      endTime: toLocalInputValue(new Date(entry.endTime)),
      allDay: entry.allDay,
      location: entry.location || '',
      recurrenceRule: entry.recurrenceRule || '',
      tasks: entry.checklist.map((item) => item.text).join('\n'),
      ...toReminderDraftFields(firstReminder?.minutesBefore, secondReminder?.minutesBefore),
    });
    setSelectedDate(new Date(entry.startTime));
    setIsComposerOpen(true);
  }

  function openCreateEntryComposer(input?: { date?: Date; ownerMemberId?: string }) {
    const nextDate = input?.date ?? new Date();
    const nextDraft = hydrateDraft(
      createDefaultDraft(
        input?.ownerMemberId ?? dashboard.members[0]?.id ?? '',
        dashboard.calendars[0]?.id ?? '',
        nextDate,
      ),
      dashboard.members,
      dashboard.calendars,
    );

    setSelectedDate(nextDate);
    setEditingEntryId(null);
    setDraft(nextDraft);
    setIsComposerOpen(true);
  }

  function closeEntryComposer() {
    setIsComposerOpen(false);
    setEditingEntryId(null);
    setDraft(createDefaultDraft(dashboard.members[0]?.id, dashboard.calendars[0]?.id));
  }

  async function handleDeleteFoodPlan(weekStart: string, day: FoodPlanDay) {
    try {
      setErrorText('');
      setDeletingFoodPlan({ weekStart, day });
      await deleteFoodPlan({ weekStart, day });
      const weekFoodPlan = await loadFoodPlan(getWeekStart());
      setFoodPlan(weekFoodPlan.items);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete food plan item');
    } finally {
      setDeletingFoodPlan(null);
    }
  }

  function openFoodPlanComposer(input: { weekStart: string; day: FoodPlanDay; item?: FoodPlanItem }) {
    setFoodPlanEditingKey(input.item ? `${input.item.weekStart}-${input.item.day}` : null);
    setFoodPlanDraft({
      weekStart: input.weekStart,
      day: input.day,
      dishName: input.item?.dishName ?? '',
      groceryInput: (input.item?.groceryList ?? []).join('\n'),
    });
    setFoodPlanComposerOpen(true);
  }

  function closeFoodPlanComposer() {
    setFoodPlanComposerOpen(false);
    setFoodPlanDraft(null);
    setFoodPlanEditingKey(null);
  }

  async function handleSaveFoodPlan() {
    if (!foodPlanDraft) {
      return;
    }

    const dishName = foodPlanDraft.dishName.trim();
    if (!dishName) {
      setErrorText('Dish name is required');
      return;
    }

    const groceryList = foodPlanDraft.groceryInput
      .split(/\r?\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    try {
      setFoodPlanSaving(true);
      setErrorText('');
      await updateFoodPlan({
        weekStart: foodPlanDraft.weekStart,
        day: foodPlanDraft.day,
        dishName,
        groceryList,
      });
      const weekFoodPlan = await loadFoodPlan(foodPlanDraft.weekStart);
      setFoodPlan(weekFoodPlan.items);
      closeFoodPlanComposer();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save food plan item');
    } finally {
      setFoodPlanSaving(false);
    }
  }

  async function handleDeleteFoodPlanFromComposer() {
    if (!foodPlanDraft || !foodPlanEditingKey) {
      return;
    }

    await handleDeleteFoodPlan(foodPlanDraft.weekStart, foodPlanDraft.day);
    closeFoodPlanComposer();
  }

  async function handleSuggestDishIdeas() {
    if (!foodPlanDraft) {
      return;
    }

    try {
      setAssistantSuggestionBusy(true);
      setErrorText('');
      const result = await askAssistant({
        language: settings?.assistant.language ?? 'en',
        message: `Suggest 5 family dish ideas for ${foodPlanDraft.day}. Keep each idea short and practical.`,
      });
      setAssistantResponse(result.response);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not fetch dish suggestions');
    } finally {
      setAssistantSuggestionBusy(false);
    }
  }

  async function refreshMembers() {
    const members = await loadMembers();
    setDashboard((current) => ({ ...current, members }));
    setSyncRunDraft((current) => ({
      ...current,
      ownerMemberId: current.ownerMemberId || members[0]?.id || '',
    }));
  }

  async function handleSaveMember() {
    const name = memberDraft.name.trim();
    if (!name) {
      setErrorText('Member name is required');
      return;
    }

    try {
      setErrorText('');
      if (editingMemberId) {
        await updateMember(editingMemberId, {
          name,
          role: memberDraft.role,
          email: memberDraft.email.trim() || undefined,
        });
      } else {
        await createMember({
          name,
          role: memberDraft.role,
          email: memberDraft.email.trim() || undefined,
        });
      }

      await refreshMembers();
      setMemberDraft({ name: '', role: 'parent', email: '' });
      setEditingMemberId(null);
      setSettingsMessage(editingMemberId ? 'Member updated.' : 'Member created.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save member');
    }
  }

  function startEditMember(member: Member) {
    setEditingMemberId(member.id);
    setMemberDraft({
      name: member.name,
      role: member.role,
      email: member.email ?? '',
    });
  }

  async function handleTestMail() {
    if (!settings) {
      return;
    }

    try {
      setErrorText('');
      setMailActionBusy(true);
      const result = await sendTestEmail({ to: settings.mail.testRecipient });
      setSettingsMessage(result.message);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not send test email');
    } finally {
      setMailActionBusy(false);
    }
  }

  async function handlePullInbox() {
    try {
      setErrorText('');
      setMailActionBusy(true);
      const result = await pullInboxToMailpit({ limit: 25 });
      setSettingsMessage(`Imported ${result.importedCount} inbox messages.`);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not pull inbox to mailpit');
    } finally {
      setMailActionBusy(false);
    }
  }

  async function handleConnectSync() {
    if (!settings) {
      return;
    }

    try {
      setErrorText('');
      setSyncActionBusy(true);
      const result = await connectSync({
        provider: settings.sync.provider,
        configJson: settings.sync.configJson,
      });

      const next = await saveSettings({
        sync: {
          provider: result.provider,
          isConnected: result.isConnected,
          configJson: settings.sync.configJson,
        },
      });
      setSettings(next);
      setSettingsMessage(result.message);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not connect sync provider');
    } finally {
      setSyncActionBusy(false);
    }
  }

  async function handleRunSyncNow() {
    if (!syncRunDraft.calendarId || !syncRunDraft.ownerMemberId) {
      setErrorText('Select calendar and member before running sync');
      return;
    }

    try {
      setErrorText('');
      setSyncActionBusy(true);
      const result = await runSync({
        calendarId: syncRunDraft.calendarId,
        ownerMemberId: syncRunDraft.ownerMemberId,
        provider: settings?.sync.provider,
        icsUrl: syncRunDraft.icsUrl.trim() || undefined,
        rawContent: syncRunDraft.rawContent.trim() || undefined,
      });
      await handleRefresh();
      setSettingsMessage(result.message);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not run sync');
    } finally {
      setSyncActionBusy(false);
    }
  }

  async function handleToggleRecurring(entry: Entry) {
    try {
      setErrorText('');
      await updateEntry(getEntryMutationId(entry), { recurrenceRule: undefined });
      await handleRefresh();
      setSettingsMessage('Recurring rule removed from entry.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update recurring entry');
    }
  }

  async function handleUpdateRecurringRule(entry: Entry) {
    const nextRule = window.prompt('Recurrence rule', entry.recurrenceRule ?? '');
    if (nextRule === null) {
      return;
    }

    try {
      setErrorText('');
      await updateEntry(getEntryMutationId(entry), { recurrenceRule: nextRule.trim() || undefined });
      await handleRefresh();
      setSettingsMessage('Recurring rule updated.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update recurring rule');
    }
  }

  async function persistSyncConfig(configJson: Record<string, unknown>, message: string) {
    if (!settings) {
      return;
    }

    try {
      setSavingSettings(true);
      setErrorText('');
      const next = await saveSettings({
        sync: {
          provider: settings.sync.provider,
          isConnected: settings.sync.isConnected,
          configJson,
        },
      });
      setSettings(next);
      setSettingsMessage(message);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save sync settings');
    } finally {
      setSavingSettings(false);
    }
  }

  async function handleSaveBirthday() {
    if (!birthdaysDraft.name.trim() || !birthdaysDraft.date) {
      setErrorText('Birthday name and date are required');
      return;
    }

    const nextId = birthdaysDraft.id ?? `birthday-${Date.now()}`;
    const current = birthdays.filter((item) => item.id !== nextId);
    const nextBirthdays = [
      ...current,
      {
        id: nextId,
        name: birthdaysDraft.name.trim(),
        date: birthdaysDraft.date,
        memberId: birthdaysDraft.memberId || undefined,
        notifyDaysBefore: birthdaysDraft.notifyDaysBefore,
      },
    ].sort((left, right) => left.date.localeCompare(right.date));

    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      birthdays: nextBirthdays,
    }, birthdaysDraft.id ? 'Birthday updated.' : 'Birthday added.');

    setBirthdaysDraft({ name: '', date: '', memberId: '', notifyDaysBefore: 7 });
  }

  async function handleDeleteBirthday(id: string) {
    const nextBirthdays = birthdays.filter((item) => item.id !== id);
    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      birthdays: nextBirthdays,
    }, 'Birthday removed.');
  }

  function handleEditBirthday(id: string) {
    const item = birthdays.find((value) => value.id === id);
    if (!item) {
      return;
    }

    setBirthdaysDraft({
      id: item.id,
      name: item.name,
      date: item.date,
      memberId: item.memberId ?? '',
      notifyDaysBefore: item.notifyDaysBefore,
    });
  }

  async function handleSaveWeather(config: { location: string; state: string; country: string; unit: 'C' | 'F'; updateFrequencyMinutes: number }) {
    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      weather: config,
    }, 'Weather settings saved.');
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-6 py-4 shadow-2xl shadow-black/20 backdrop-blur">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Loading the new dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'hidden shrink-0 border-r border-sidebar-border bg-sidebar/80 py-5 backdrop-blur transition-all duration-300 md:flex md:flex-col',
            isSidebarCollapsed ? 'w-20 px-2' : 'w-72 px-4',
          )}
        >
          <div className={cn('mb-5 flex items-center', isSidebarCollapsed ? 'flex-col gap-3' : 'gap-3')}>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <CalendarDays className="h-5 w-5" />
            </div>
            {!isSidebarCollapsed ? (
              <div>
                <div className="text-sm font-semibold tracking-tight">MentalLoad</div>
                <div className="text-xs text-muted-foreground">Refit frontend, stable backend</div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/55 text-muted-foreground transition hover:text-foreground',
                isSidebarCollapsed ? '' : 'ml-auto',
              )}
              aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </div>

          <nav className="space-y-2" aria-label="Primary navigation">
            {[
              { label: 'Dashboard', icon: CalendarDays, key: 'dashboard' },
              { label: 'Planner', icon: Clock3, key: 'planner' },
              { label: 'Family', icon: Users, key: 'family' },
              { label: 'Settings', icon: Settings, key: 'settings' },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => handleNavClick(item.key as NavSection)}
                className={cn(
                  'flex w-full items-center rounded-2xl py-3 text-sm transition-colors',
                  isSidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3',
                  activeNav === item.key ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
                )}
                aria-label={item.label}
                title={isSidebarCollapsed ? item.label : undefined}
              >
                <item.icon className="h-4 w-4" />
                {!isSidebarCollapsed ? <span>{item.label}</span> : null}
              </button>
            ))}
          </nav>

          <div className="mt-8" id="family-section">
            {!isSidebarCollapsed ? <div className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Family members</div> : null}
            <div className="space-y-2">
              {dashboard.members.map((member) => (
                <div
                  key={member.id}
                  className={cn(
                    'flex rounded-2xl py-2.5 hover:bg-sidebar-accent/60',
                    isSidebarCollapsed ? 'justify-center px-1' : 'items-center gap-3 px-3',
                  )}
                  title={isSidebarCollapsed ? `${member.name} (${member.role})` : undefined}
                >
                  <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground', memberColorById[member.id] ?? 'bg-primary')}>
                    <Users className="h-5 w-5" />
                  </div>
                  {!isSidebarCollapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{member.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{member.role}</div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          {isSidebarCollapsed ? (
            <div className="mt-auto flex justify-center">
              <div className="rounded-2xl border border-border/60 bg-card/70 p-2.5 shadow-lg shadow-black/10 backdrop-blur" title={assistantStatusText}>
                <Wifi className={cn('h-4 w-4', assistantReady ? 'text-primary' : 'text-muted-foreground')} />
              </div>
            </div>
          ) : (
            <div className="mt-auto rounded-3xl border border-border/60 bg-card/70 p-4 shadow-lg shadow-black/10 backdrop-blur">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Wifi className={cn('h-4 w-4', assistantReady ? 'text-primary' : 'text-muted-foreground')} />
                {assistantReady ? 'Assistant online' : 'Assistant fallback'}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">{assistantStatusText}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full border border-border/60 px-2 py-1">Persistence: {dashboard.persistence ?? 'unknown'}</span>
                <span className="rounded-full border border-border/60 px-2 py-1">Server time: {formatStamp(healthNow)}</span>
              </div>
            </div>
          )}
        </aside>

        <main className="flex min-h-screen flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-4 border-b border-border/50 bg-card/40 px-4 backdrop-blur md:px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/15 md:hidden">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search entries, members, or categories"
                aria-label="Search"
                className="h-11 w-full rounded-2xl border border-border/60 bg-background/60 pl-10 pr-4 text-sm outline-none ring-0 transition focus:border-primary/60"
              />
            </div>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
              aria-label="Refresh dashboard"
            >
              <RefreshCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="relative flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-3 top-3 h-2 w-2 rounded-full bg-primary" />
            </button>
            <button
              type="button"
              onClick={() => openCreateEntryComposer()}
              className="flex h-10 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:brightness-110"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add event</span>
            </button>
          </header>

          <section className="flex-1 overflow-auto px-4 py-6 md:px-6">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
              <div id="hero-section" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    New frontend baseline
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight">Family operations dashboard</h1>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">
                    The old planner has been replaced with a clean dashboard built on the ref template direction. It reads from the existing backend, shows live family data, and keeps creation on the same API contracts.
                  </p>
                </div>
                <div className="rounded-3xl border border-border/60 bg-card/60 px-4 py-3 shadow-lg shadow-black/10 backdrop-blur">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wider">7-Day Weather</div>
                  <div className="mb-2 text-[11px] text-muted-foreground">
                    {weatherForecast?.resolvedLocation ? `${weatherForecast.resolvedLocation.name}${weatherForecast.resolvedLocation.admin1 ? `, ${weatherForecast.resolvedLocation.admin1}` : ''}${weatherForecast.resolvedLocation.country ? `, ${weatherForecast.resolvedLocation.country}` : ''}` : 'Set Weather location in Settings'}
                  </div>
                  {weatherLoading ? (
                    <div className="flex h-20 items-center justify-center text-muted-foreground">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      {weatherForecast?.daily.slice(0, 7).map((day) => (
                        <div key={day.date} className="flex flex-col items-center rounded-xl bg-background/60 px-2 py-2 text-center text-[11px]">
                          <div className="font-semibold">{new Date(day.date).toLocaleDateString(undefined, { weekday: 'short' })}</div>
                          <div className="text-base">{day.icon}</div>
                          <div className="text-muted-foreground">{Math.round(day.tempMax)}°{weatherForecast.unit}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {errorText ? (
                <div className="rounded-3xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
                  {errorText}
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {statCards.map((stat) => (
                  <div key={stat.label} className="panel-surface rounded-[28px] border border-border/60 p-5 shadow-xl shadow-black/10">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{stat.label}</div>
                        <div className="mt-3 text-3xl font-semibold tracking-tight">{stat.value}</div>
                        <div className="mt-1 text-sm text-muted-foreground">{stat.subtext}</div>
                      </div>
                      <div className={cn('rounded-2xl p-3', stat.color)}>
                        <stat.icon className="h-5 w-5" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
                <section id="planner-section" className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                  <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight">{MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Recurring entries are expanded from the backend occurrence feed.</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setCurrentMonth(previousMonth(currentMonth))} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/50 hover:bg-accent/70" aria-label="Previous month">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-sm hover:bg-accent/70">
                        Today
                      </button>
                      <button type="button" onClick={() => setCurrentMonth(nextMonth(currentMonth))} className="flex h-9 w-9 items-center justify-center rounded-xl border border-border/60 bg-background/50 hover:bg-accent/70" aria-label="Next month">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-7 gap-px overflow-hidden rounded-[24px] border border-border/60 bg-border/60">
                    {DAYS.map((day) => (
                      <div key={day} className="bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {day}
                      </div>
                    ))}
                    {monthDays.map((day, index) => {
                      const date = day ? new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day) : null;
                      const entries = date ? getEntriesForDate(monthOccurrences, dashboard.members, date, searchQuery) : [];
                      return (
                        <div
                          key={`${day ?? 'empty'}-${index}`}
                          role={day ? 'button' : undefined}
                          tabIndex={day ? 0 : -1}
                          onClick={() => {
                            if (date) {
                              openCreateEntryComposer({ date });
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!day) {
                              return;
                            }

                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openCreateEntryComposer({ date: date as Date });
                            }
                          }}
                          className={cn(
                            'min-h-[132px] bg-card px-3 py-3 text-left align-top transition hover:bg-accent/45',
                            !day && 'bg-card/60',
                            day && isSameCalendarDate(date, selectedDate) && 'bg-accent',
                          )}
                        >
                          {day ? (
                            <>
                              <div className="mb-3 flex items-center justify-between">
                                <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm', isToday(date) ? 'bg-primary text-primary-foreground' : 'text-foreground')}>
                                  {day}
                                </div>
                                {entries.length ? <span className="text-[11px] text-muted-foreground">{entries.length}</span> : null}
                              </div>
                              <div className="space-y-1.5">
                                {entries.slice(0, 3).map((entry) => (
                                  <button
                                    key={entry.id}
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleEditEntry(entry);
                                    }}
                                    className={cn('w-full truncate rounded-xl px-2 py-1 text-left text-xs font-medium text-primary-foreground', memberColorById[entry.ownerMemberId] ?? 'bg-primary')}
                                  >
                                    {entry.title}
                                  </button>
                                ))}
                                {entries.length > 3 ? <div className="px-2 text-[11px] text-muted-foreground">+{entries.length - 3} more</div> : null}
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-6 rounded-[26px] border border-border/60 bg-background/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-lg font-semibold">{formatSelectedDate(selectedDate)}</h3>
                      <span className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Day agenda</span>
                    </div>
                    <div className="space-y-3">
                      {selectedEntries.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No matching entries for this day.</div>
                      ) : selectedEntries.map((entry) => {
                        const owner = dashboard.members.find((member) => member.id === entry.ownerMemberId);
                        return (
                          <div
                            key={entry.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleEditEntry(entry)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleEditEntry(entry);
                              }
                            }}
                            className="flex w-full items-start gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3 text-left"
                          >
                            <div className={cn('mt-1 h-10 w-1 rounded-full', memberColorById[entry.ownerMemberId] ?? 'bg-primary')} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold">{entry.title}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">{owner?.name ?? 'Unknown member'} · {entry.type} · {formatTimeRange(entry)}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{entry.status}</div>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      handleEditEntry(entry);
                                    }}
                                    className="rounded-lg border border-border/40 p-1.5 hover:bg-accent/60"
                                    aria-label={`Edit ${entry.title}`}
                                  >
                                    <Edit2 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteEntry(getEntryMutationId(entry));
                                    }}
                                    disabled={deletingEntryId === getEntryMutationId(entry)}
                                    className="rounded-lg border border-border/40 p-1.5 hover:bg-destructive/10 disabled:opacity-60"
                                    aria-label={`Delete ${entry.title}`}
                                  >
                                    {deletingEntryId === getEntryMutationId(entry) ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                  </button>
                                </div>
                              </div>
                              {entry.location ? <div className="mt-2 text-xs text-muted-foreground">{entry.location}</div> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <aside className="flex min-h-[600px] flex-col gap-6">
                  <section className="panel-surface flex min-h-[320px] flex-col rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Upcoming events</h2>
                        <p className="mt-1 text-sm text-muted-foreground">Next 30 days, including recurring occurrences.</p>
                      </div>
                      <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{filteredUpcoming.length} items</div>
                    </div>
                    <div className="space-y-3 overflow-auto">
                      {filteredUpcoming.map((entry) => {
                        const owner = dashboard.members.find((member) => member.id === entry.ownerMemberId);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => handleEditEntry(entry)}
                            className="w-full rounded-2xl border border-border/60 bg-card/55 p-4 text-left transition hover:bg-accent/45"
                          >
                            <div className="flex items-start gap-3">
                              <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground', memberColorById[entry.ownerMemberId] ?? 'bg-primary')}>
                                <Users className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-3">
                                  <div>
                                    <div className="truncate text-sm font-semibold">{entry.title}</div>
                                    <div className="mt-1 text-xs text-muted-foreground">{formatUpcomingDate(entry.startTime)} · {owner?.name ?? 'Unknown'}</div>
                                  </div>
                                  <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{entry.type}</div>
                                </div>
                                <div className="mt-3 text-xs text-muted-foreground">{formatTimeRange(entry)}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {filteredUpcoming.length === 0 ? <div className="rounded-2xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">No upcoming events match the current search.</div> : null}
                    </div>
                  </section>

                  <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Food plan</h2>
                        <p className="mt-1 text-sm text-muted-foreground">Current week from the backend food plan API.</p>
                      </div>
                      <div className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">{foodPlan.length} meals</div>
                    </div>
                    <div className="space-y-2">
                      {(() => {
                        const weekStart = getWeekStart();
                        const days: Array<{ key: string; label: string }> = [
                          { key: 'monday', label: 'Monday' },
                          { key: 'tuesday', label: 'Tuesday' },
                          { key: 'wednesday', label: 'Wednesday' },
                          { key: 'thursday', label: 'Thursday' },
                          { key: 'friday', label: 'Friday' },
                          { key: 'saturday', label: 'Saturday' },
                          { key: 'sunday', label: 'Sunday' },
                        ];

                        return days.map(({ key, label }) => {
                          const item = foodPlan.find((fp) => fp.day.toLowerCase() === key);

                          return (
                            <div key={key} className="rounded-2xl border border-border/60 bg-card/55 px-4 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
                                  <div className="mt-1 text-sm font-semibold">
                                    {item?.dishName || <span className="text-muted-foreground">Not hungry?</span>}
                                  </div>
                                </div>
                                {item ? (
                                  <div className="flex items-center gap-2">
                                    <div className="text-xs text-muted-foreground">{item.groceryList.length} groceries</div>
                                    <button
                                      type="button"
                                      onClick={() => openFoodPlanComposer({ weekStart: item.weekStart, day: item.day, item })}
                                      className="rounded-lg border border-border/40 p-1.5 hover:bg-accent/60"
                                      aria-label={`Edit ${item.dishName}`}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteFoodPlan(item.weekStart, item.day)}
                                      disabled={deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day}
                                      className="rounded-lg border border-border/40 p-1.5 hover:bg-destructive/10 disabled:opacity-60"
                                      aria-label={`Delete ${item.dishName}`}
                                    >
                                      {deletingFoodPlan?.weekStart === item.weekStart && deletingFoodPlan?.day === item.day ? (
                                        <LoaderCircle className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </button>
                                  </div>
                                ) : (
                                  <button type="button" onClick={() => openFoodPlanComposer({ weekStart, day: key as FoodPlanDay })} className="rounded-lg border border-border/40 p-1.5 hover:bg-primary/10">
                                    <Plus className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                              {item && item.groceryList.length > 0 ? (
                                <div className="mt-2 text-xs text-muted-foreground">{item.groceryList.join(' · ')}</div>
                              ) : null}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </section>

                  <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold">Assistant</h2>
                        <p className="mt-1 text-sm text-muted-foreground">Parse natural language into a backend draft and confirm it.</p>
                      </div>
                      <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs', assistantReady ? 'bg-primary/12 text-primary' : 'bg-accent text-muted-foreground')}>
                        <Sparkles className="h-4 w-4" />
                        {assistantReady ? 'Assistant ready' : 'Fallback mode'}
                      </div>
                    </div>
                    <label className="mt-4 block text-sm font-medium" htmlFor="assistant-message">Assistant message</label>
                    <textarea
                      id="assistant-message"
                      aria-label="Assistant message"
                      value={assistantMessage}
                      onChange={(event) => setAssistantMessage(event.target.value)}
                      placeholder="Example: make an event tomorrow at 10:00 in Saga calendar: Birthday at ELLA"
                      className="mt-2 min-h-[110px] w-full rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => void handleAssistantParse()} disabled={assistantBusy} className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60">
                        {assistantBusy ? 'Parsing...' : 'Parse with assistant'}
                      </button>
                      <button type="button" onClick={() => void handleAssistantSuggestion()} disabled={assistantSuggestionBusy} className="rounded-2xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm font-medium hover:bg-accent/60 disabled:opacity-60">
                        {assistantSuggestionBusy ? 'Thinking...' : 'Ask AI suggestion'}
                      </button>
                      {assistantDraft && assistantMissingFields.length === 0 ? (
                        <button type="button" onClick={() => void handleAssistantConfirm()} disabled={assistantBusy} className="rounded-2xl border border-border/60 bg-background/60 px-4 py-2.5 text-sm font-medium hover:bg-accent/60 disabled:opacity-60">
                          Confirm assistant draft
                        </button>
                      ) : null}
                    </div>
                    {assistantResponse ? <div className="mt-4 rounded-2xl border border-border/60 bg-background/40 px-4 py-3 text-sm">{assistantResponse}</div> : null}
                    {assistantDraft ? (
                      <div className="mt-4 rounded-2xl border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
                        <div className="font-medium text-foreground">Draft: {assistantDraft.title}</div>
                        <div className="mt-1">Type: {assistantDraft.type}</div>
                        <div>When: {assistantDraft.startTime ? formatStamp(assistantDraft.startTime) : 'Missing date/time'}</div>
                        {assistantMissingFields.length > 0 ? <div className="mt-2 text-destructive">Missing: {assistantMissingFields.join(', ')}</div> : null}
                      </div>
                    ) : null}
                  </section>
                </aside>
              </div>
            </div>

            <section id="agenda-section" className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              <div className="mb-4">
                <h2 className="text-2xl font-semibold tracking-tight">7-Day Agenda</h2>
                <p className="mt-1 text-sm text-muted-foreground">Week overview with all members.</p>
              </div>
              <AgendaView
                members={dashboard.members}
                entries={monthOccurrences}
                memberColorById={memberColorById}
                onSelectEntry={handleEditEntry}
                onSelectDate={(date, ownerMemberId) => openCreateEntryComposer({ date, ownerMemberId })}
                dayWeatherByDate={dayWeatherByDate}
              />
            </section>

            <section id="family-section-content" className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
              <div className="mb-6 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Family Members</h2>
                  <p className="mt-1 text-sm text-muted-foreground">Create and edit members synced with backend APIs.</p>
                </div>
              </div>

              <div className="mb-5 grid gap-3 rounded-2xl border border-border/60 bg-background/30 p-4 md:grid-cols-[1fr_140px_1fr_auto] md:items-end">
                <label className="grid gap-1.5">
                  <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</span>
                  <input
                    value={memberDraft.name}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, name: event.target.value }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    placeholder="Member name"
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Role</span>
                  <select
                    value={memberDraft.role}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value as MemberRole }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="parent">parent</option>
                    <option value="child">child</option>
                  </select>
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Email</span>
                  <input
                    value={memberDraft.email}
                    onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    placeholder="name@example.com"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleSaveMember()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20"
                >
                  {editingMemberId ? 'Update member' : 'Add member'}
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {dashboard.members.map((member) => (
                  <div key={member.id} className="rounded-2xl border border-border/60 bg-card/55 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn('flex h-11 w-11 items-center justify-center rounded-full text-primary-foreground', memberColorById[member.id] ?? 'bg-primary')}>
                          <Users className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">{member.name}</div>
                          <div className="text-xs text-muted-foreground">{member.role}</div>
                          {member.email ? <div className="truncate text-xs text-muted-foreground">{member.email}</div> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditMember(member)}
                        className="rounded-lg border border-border/50 p-2 hover:bg-accent/60"
                        aria-label={`Edit ${member.name}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </main>
      </div>

      {isComposerOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:px-4 sm:py-4">
          <div className="flex w-full max-w-2xl flex-col rounded-t-[28px] border border-border/60 bg-card/97 shadow-2xl shadow-black/30 sm:max-h-[92vh] sm:rounded-[28px]" style={{ maxHeight: '92dvh' }}>
            {/* sticky header */}
            <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/50 px-5 py-3">
              <h2 className="text-base font-semibold tracking-tight">{editingEntryId ? 'Edit entry' : 'New entry'}</h2>
              <button type="button" onClick={closeEntryComposer} className="rounded-lg border border-border/60 p-1.5 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* scrollable body */}
            <div className="overflow-y-auto">
            <form className="grid gap-3 p-5 md:grid-cols-2" onSubmit={handleCreateEntry}>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Title</span>
                <input aria-label="Title" value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" required />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Type</span>
                <select aria-label="Type" value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value as Entry['type'] }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                  <option value="event">Event</option>
                  <option value="task">Task</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">All day</span>
                <select aria-label="All day" value={draft.allDay ? 'yes' : 'no'} onChange={(event) => setDraft((current) => ({ ...current, allDay: event.target.value === 'yes' }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                  <option value="no">Timed</option>
                  <option value="yes">All day</option>
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Member</span>
                <select aria-label="Member" value={draft.ownerMemberId} onChange={(event) => setDraft((current) => ({ ...current, ownerMemberId: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                  {dashboard.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Calendar</span>
                <select aria-label="Calendar" value={draft.calendarId} onChange={(event) => setDraft((current) => ({ ...current, calendarId: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                  {dashboard.calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Start</span>
                <input aria-label="Start" type="datetime-local" value={draft.startTime} onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" required />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">End</span>
                <input aria-label="End" type="datetime-local" value={draft.endTime} onChange={(event) => setDraft((current) => ({ ...current, endTime: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" required />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Location</span>
                <input aria-label="Location" value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recurrence</span>
                <input aria-label="Recurrence rule" value={draft.recurrenceRule} onChange={(event) => setDraft((current) => ({ ...current, recurrenceRule: event.target.value }))} placeholder="FREQ=WEEKLY;COUNT=6" className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" />
              </label>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks (one per line)</span>
                <textarea
                  aria-label="Tasks"
                  value={draft.tasks}
                  onChange={(event) => setDraft((current) => ({ ...current, tasks: event.target.value }))}
                  placeholder="One task per line"
                  className="min-h-[72px] rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <div className="grid gap-3 md:col-span-2 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reminder 1</span>
                  <select
                    aria-label="Reminder 1"
                    value={draft.reminder1Mode}
                    onChange={(event) => setDraft((current) => ({ ...current, reminder1Mode: event.target.value as ReminderDraftMode }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  >
                    {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    <option value="custom">Custom hours before</option>
                  </select>
                  {draft.reminder1Mode === 'custom' ? (
                    <input
                      aria-label="Reminder 1 custom hours"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={draft.reminder1CustomHours}
                      onChange={(event) => setDraft((current) => ({ ...current, reminder1CustomHours: event.target.value }))}
                      placeholder="Hours before"
                      className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    />
                  ) : null}
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Reminder 2</span>
                  <select
                    aria-label="Reminder 2"
                    value={draft.reminder2Mode}
                    onChange={(event) => setDraft((current) => ({ ...current, reminder2Mode: event.target.value as ReminderDraftMode }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  >
                    {REMINDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    <option value="custom">Custom hours before</option>
                  </select>
                  {draft.reminder2Mode === 'custom' ? (
                    <input
                      aria-label="Reminder 2 custom hours"
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={draft.reminder2CustomHours}
                      onChange={(event) => setDraft((current) => ({ ...current, reminder2CustomHours: event.target.value }))}
                      placeholder="Hours before"
                      className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    />
                  ) : null}
                </label>
              </div>
              {/* sticky footer */}
              <div className="md:col-span-2 flex items-center justify-end gap-2 border-t border-border/50 pt-3">
                <div className="flex items-center gap-2">
                  {editingEntryId ? (
                    <button
                      type="button"
                      onClick={() => void handleDeleteEntryFromComposer()}
                      disabled={deletingEntryId === editingEntryId}
                      className="inline-flex items-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-60"
                    >
                      {deletingEntryId === editingEntryId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Delete
                    </button>
                  ) : null}
                  <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-110">
                    <Plus className="h-4 w-4" />
                    {editingEntryId ? 'Update' : 'Save'}
                  </button>
                </div>
              </div>
            </form>
            </div>{/* end scrollable body */}
          </div>
        </div>
      ) : null}

      {foodPlanComposerOpen && foodPlanDraft ? (
        <OverlayPanel title={foodPlanEditingKey ? 'Edit dish' : 'Create dish'} onClose={closeFoodPlanComposer}>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveFoodPlan();
            }}
          >
            <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-xs text-muted-foreground uppercase tracking-[0.14em]">
              {foodPlanDraft.day} · week {foodPlanDraft.weekStart}
            </div>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Dish name</span>
              <input
                value={foodPlanDraft.dishName}
                onChange={(event) => setFoodPlanDraft((current) => (current ? { ...current, dishName: event.target.value } : current))}
                className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                placeholder="Example: Chicken pasta bake"
                required
              />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium">Groceries</span>
              <textarea
                value={foodPlanDraft.groceryInput}
                onChange={(event) => setFoodPlanDraft((current) => (current ? { ...current, groceryInput: event.target.value } : current))}
                className="min-h-[110px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                placeholder="One item per line, or comma separated"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSuggestDishIdeas()}
                disabled={assistantSuggestionBusy}
                className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
              >
                {assistantSuggestionBusy ? 'Asking AI...' : 'Suggest dishes with AI'}
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 pt-2">
              <div className="flex gap-2">
                {foodPlanEditingKey ? (
                  <button
                    type="button"
                    onClick={() => void handleDeleteFoodPlanFromComposer()}
                    disabled={deletingFoodPlan?.weekStart === foodPlanDraft.weekStart && deletingFoodPlan?.day === foodPlanDraft.day}
                    className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive hover:bg-destructive/15 disabled:opacity-60"
                  >
                    Delete dish
                  </button>
                ) : null}
              </div>
              <button
                type="submit"
                disabled={foodPlanSaving}
                className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60"
              >
                {foodPlanSaving ? 'Saving...' : foodPlanEditingKey ? 'Update dish' : 'Save dish'}
              </button>
            </div>
          </form>
        </OverlayPanel>
      ) : null}

      {notificationsOpen ? (
        <OverlayPanel title="Notifications" onClose={() => setNotificationsOpen(false)}>
          {dashboard.reminderJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No scheduled reminder jobs are currently queued.</p>
          ) : (
            <div className="space-y-3">
              {dashboard.reminderJobs.map((job) => (
                <div key={job.id} className="rounded-2xl border border-border/60 bg-background/40 px-4 py-3 text-sm">
                  <div className="font-medium">Reminder {job.id}</div>
                  <div className="mt-1 text-muted-foreground">Runs at {formatStamp(job.runAt)}</div>
                </div>
              ))}
            </div>
          )}
        </OverlayPanel>
      ) : null}

      {settingsOpen && settings ? (
        <OverlayPanel title="Settings" size="wide" onClose={() => { setSettingsOpen(false); setSettingsTab('theme'); }}>
          <div className="mb-6 flex gap-2 overflow-x-auto border-b border-border/60">
            {[
              { id: 'theme', label: 'Theme' },
              { id: 'members', label: 'Members' },
              { id: 'mail', label: 'Mail' },
              { id: 'sync', label: 'Sync' },
              { id: 'recurring', label: 'Recurring' },
              { id: 'birthdays', label: 'Birthdays' },
              { id: 'weather', label: 'Weather' },
            ].map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSettingsTab(id as typeof settingsTab)}
                className={cn(
                  'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition',
                  settingsTab === id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid gap-4">
            {settingsTab === 'theme' ? (
              <>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Theme mode</span>
                  <select aria-label="Theme mode" value={settings.theme.mode} onChange={(event) => setSettings((current) => (current ? { ...current, theme: { ...current.theme, mode: event.target.value as AppSettings['theme']['mode'] } } : current))} className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60">
                    <option value="system">system</option>
                    <option value="light">light</option>
                    <option value="dark">dark</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Appearance</span>
                  <select aria-label="Appearance" value={settings.theme.appearance} onChange={(event) => setSettings((current) => (current ? { ...current, theme: { ...current.theme, appearance: event.target.value as AppSettings['theme']['appearance'] } } : current))} className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60">
                    <option value="classic">classic</option>
                    <option value="glass">glass</option>
                  </select>
                </label>
              </>
            ) : null}

            {settingsTab === 'members' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                  Manage members from this panel. The backend currently supports create and update routes.
                </div>
                <div className="space-y-2">
                  {dashboard.members.map((member) => (
                    <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/30 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold">{member.name}</div>
                        <div className="text-xs text-muted-foreground">{member.role} {member.email ? `· ${member.email}` : ''}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEditMember(member)}
                        className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
                      >
                        Edit
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {settingsTab === 'mail' ? (
              <div className="space-y-3">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">IMAP host</span>
                  <input
                    value={settings.mail.imapHost}
                    onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapHost: event.target.value } } : current)}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">SMTP host</span>
                    <input
                      value={settings.mail.smtpHost}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpHost: event.target.value } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">SMTP user</span>
                    <input
                      value={settings.mail.smtpUser}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpUser: event.target.value } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Test recipient</span>
                  <input
                    value={settings.mail.testRecipient}
                    onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, testRecipient: event.target.value } } : current)}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTestMail()}
                    disabled={mailActionBusy}
                    className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
                  >
                    Send test email
                  </button>
                  <button
                    type="button"
                    onClick={() => void handlePullInbox()}
                    disabled={mailActionBusy}
                    className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
                  >
                    Pull inbox to mailpit
                  </button>
                </div>
              </div>
            ) : null}

            {settingsTab === 'sync' ? (
              <div className="space-y-3">
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Provider</span>
                  <select
                    value={settings.sync.provider}
                    onChange={(event) => setSettings((current) => current ? { ...current, sync: { ...current.sync, provider: event.target.value as SyncProvider } } : current)}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="none">none</option>
                    <option value="apple">apple</option>
                    <option value="google">google</option>
                    <option value="outlook">outlook</option>
                    <option value="invite-mail">invite-mail</option>
                  </select>
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Feed URL</span>
                  <input
                    value={String(settings.sync.configJson.feedUrl ?? '')}
                    onChange={(event) => setSettings((current) => current ? { ...current, sync: { ...current.sync, configJson: { ...current.sync.configJson, feedUrl: event.target.value } } } : current)}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Default calendar id</span>
                    <input
                      value={String(settings.sync.configJson.calendarId ?? '')}
                      onChange={(event) => setSettings((current) => current ? { ...current, sync: { ...current.sync, configJson: { ...current.sync.configJson, calendarId: event.target.value } } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Inbox source</span>
                    <input
                      value={String(settings.sync.configJson.inboxSource ?? '')}
                      onChange={(event) => setSettings((current) => current ? { ...current, sync: { ...current.sync, configJson: { ...current.sync.configJson, inboxSource: event.target.value } } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Run sync for calendar</span>
                    <select
                      value={syncRunDraft.calendarId}
                      onChange={(event) => setSyncRunDraft((current) => ({ ...current, calendarId: event.target.value }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="">Select calendar</option>
                      {dashboard.calendars.map((calendar) => (
                        <option key={calendar.id} value={calendar.id}>{calendar.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Owner member</span>
                    <select
                      value={syncRunDraft.ownerMemberId}
                      onChange={(event) => setSyncRunDraft((current) => ({ ...current, ownerMemberId: event.target.value }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="">Select member</option>
                      {dashboard.members.map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">ICS URL (optional)</span>
                  <input
                    value={syncRunDraft.icsUrl}
                    onChange={(event) => setSyncRunDraft((current) => ({ ...current, icsUrl: event.target.value }))}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm font-medium">ICS raw content (optional)</span>
                  <textarea
                    value={syncRunDraft.rawContent}
                    onChange={(event) => setSyncRunDraft((current) => ({ ...current, rawContent: event.target.value }))}
                    className="min-h-[88px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  />
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleConnectSync()}
                    disabled={syncActionBusy}
                    className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
                  >
                    Connect provider
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleRunSyncNow()}
                    disabled={syncActionBusy}
                    className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
                  >
                    Run sync now
                  </button>
                </div>
              </div>
            ) : null}

            {settingsTab === 'recurring' ? (
              <div className="space-y-2">
                {recurringEntries.length === 0 ? (
                  <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">No recurring entries were found in the current month feed.</div>
                ) : (
                  recurringEntries.map((entry) => (
                    <div key={entry.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/30 px-4 py-3">
                      <div>
                        <div className="text-sm font-semibold">{entry.title}</div>
                        <div className="text-xs text-muted-foreground">{entry.recurrenceRule}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void handleUpdateRecurringRule(entry)}
                          className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
                        >
                          Edit rule
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleRecurring(entry)}
                          className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
                        >
                          Remove rule
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            ) : null}

            {settingsTab === 'birthdays' ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Name</span>
                    <input
                      value={birthdaysDraft.name}
                      onChange={(event) => setBirthdaysDraft((current) => ({ ...current, name: event.target.value }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Date</span>
                    <input
                      type="date"
                      value={birthdaysDraft.date}
                      onChange={(event) => setBirthdaysDraft((current) => ({ ...current, date: event.target.value }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Member</span>
                    <select
                      value={birthdaysDraft.memberId}
                      onChange={(event) => setBirthdaysDraft((current) => ({ ...current, memberId: event.target.value }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="">None</option>
                      {dashboard.members.map((member) => (
                        <option key={member.id} value={member.id}>{member.name}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Notify days before</span>
                    <input
                      type="number"
                      min={0}
                      value={birthdaysDraft.notifyDaysBefore}
                      onChange={(event) => setBirthdaysDraft((current) => ({ ...current, notifyDaysBefore: Number(event.target.value) || 0 }))}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void handleSaveBirthday()}
                    className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
                  >
                    {birthdaysDraft.id ? 'Update birthday' : 'Add birthday'}
                  </button>
                  {birthdaysDraft.id ? (
                    <button
                      type="button"
                      onClick={() => setBirthdaysDraft({ name: '', date: '', memberId: '', notifyDaysBefore: 7 })}
                      className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
                    >
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {birthdays.length === 0 ? (
                    <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">No birthdays configured yet.</div>
                  ) : (
                    birthdays.map((item) => (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-background/30 px-4 py-3">
                        <div>
                          <div className="text-sm font-semibold">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.date} · notify {item.notifyDaysBefore} days before</div>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={() => handleEditBirthday(item.id)} className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60">Edit</button>
                          <button type="button" onClick={() => void handleDeleteBirthday(item.id)} className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60">Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}

            {settingsTab === 'weather' ? (
              <WeatherSettingsPanel initial={weatherConfig} onSave={(value) => void handleSaveWeather(value)} />
            ) : null}

            {settingsMessage ? <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm">{settingsMessage}</div> : null}

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="text-xs text-muted-foreground">Persists through PUT /api/v1/settings.</div>
              <button type="button" onClick={() => void handleSaveSettings()} disabled={savingSettings} className="rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 disabled:opacity-60">
                {savingSettings ? 'Saving...' : 'Save settings'}
              </button>
            </div>
          </div>
        </OverlayPanel>
      ) : null}
    </div>
  );
}

function OverlayPanel({
  children,
  onClose,
  title,
  size = 'default',
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
  size?: 'default' | 'wide';
}) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 px-4 py-6 backdrop-blur-sm">
      <div className={cn('mx-auto w-full rounded-[32px] border border-border/60 bg-card/95 p-6 shadow-2xl shadow-black/30', size === 'wide' ? 'max-w-6xl' : 'max-w-xl')}>
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="rounded-xl border border-border/60 p-2 text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function WeatherSettingsPanel({
  initial,
  onSave,
}: {
  initial: { location: string; state: string; country: string; unit: 'C' | 'F'; updateFrequencyMinutes: number };
  onSave: (value: { location: string; state: string; country: string; unit: 'C' | 'F'; updateFrequencyMinutes: number }) => void;
}) {
  const [draft, setDraft] = useState(initial);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  return (
    <div className="space-y-3">
      <label className="grid gap-2">
        <span className="text-sm font-medium">Location</span>
        <input
          value={draft.location}
          onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value }))}
          placeholder="Borkop"
          className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
        />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-sm font-medium">State/Region</span>
          <input
            value={draft.state}
            onChange={(event) => setDraft((current) => ({ ...current, state: event.target.value }))}
            placeholder="Syddanmark"
            className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Country</span>
          <input
            value={draft.country}
            onChange={(event) => setDraft((current) => ({ ...current, country: event.target.value }))}
            placeholder="Denmark"
            className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2">
          <span className="text-sm font-medium">Unit</span>
          <select
            value={draft.unit}
            onChange={(event) => setDraft((current) => ({ ...current, unit: event.target.value as 'C' | 'F' }))}
            className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
          >
            <option value="C">Celsius</option>
            <option value="F">Fahrenheit</option>
          </select>
        </label>
        <label className="grid gap-2">
          <span className="text-sm font-medium">Update frequency (minutes)</span>
          <input
            type="number"
            min={5}
            value={draft.updateFrequencyMinutes}
            onChange={(event) => setDraft((current) => ({ ...current, updateFrequencyMinutes: Number(event.target.value) || 5 }))}
            className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => onSave(draft)}
        className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60"
      >
        Save weather settings
      </button>
    </div>
  );
}

type BirthdaySetting = { id: string; name: string; date: string; memberId?: string; notifyDaysBefore: number };

function parseBirthdays(value: unknown): BirthdaySetting[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const parsed: BirthdaySetting[] = [];
  value.forEach((item, index) => {
    if (!item || typeof item !== 'object') {
      return;
    }

    const source = item as Record<string, unknown>;
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    const date = typeof source.date === 'string' ? source.date : '';
    if (!name || !date) {
      return;
    }

    const id = typeof source.id === 'string' ? source.id : `birthday-${index}-${date}`;
    const memberId = typeof source.memberId === 'string' ? source.memberId : undefined;
    const notifyDaysBefore = Number(source.notifyDaysBefore ?? 7);

    parsed.push({
      id,
      name,
      date,
      memberId,
      notifyDaysBefore: Number.isFinite(notifyDaysBefore) ? notifyDaysBefore : 7,
    });
  });

  return parsed;
}

function createDefaultDraft(ownerMemberId = '', calendarId = '', date = new Date()): EventDraft {
  const { start, end } = buildDefaultTimeRange(date);
  return {
    title: '',
    type: 'event',
    ownerMemberId,
    calendarId,
    startTime: toLocalInputValue(start),
    endTime: toLocalInputValue(end),
    allDay: false,
    location: '',
    recurrenceRule: '',
    tasks: '',
    reminder1Mode: 'none',
    reminder1CustomHours: '',
    reminder2Mode: 'none',
    reminder2CustomHours: '',
  };
}

function buildDefaultTimeRange(date = new Date()) {
  const now = new Date();
  const start = new Date(date);
  start.setHours(now.getHours() + 1, now.getMinutes(), 0, 0);

  const end = new Date(start);
  end.setHours(start.getHours() + 1, start.getMinutes(), 0, 0);
  return { start, end };
}

function parseChecklistDraft(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text) => ({ text, isCompleted: false }));
}

function buildReminderPayload(draft: EventDraft) {
  const reminders = [
    toReminderPayload(draft.reminder1Mode, draft.reminder1CustomHours),
    toReminderPayload(draft.reminder2Mode, draft.reminder2CustomHours),
  ];

  const error = reminders.find((value): value is Error => value instanceof Error);
  if (error) {
    return error;
  }

  return reminders
    .filter((value): value is { minutesBefore: number } => value !== null)
    .filter((value, index, items) => items.findIndex((candidate) => candidate.minutesBefore === value.minutesBefore) === index);
}

function toReminderPayload(mode: ReminderDraftMode, customHours: string) {
  if (mode === 'none') {
    return null;
  }

  if (mode === 'custom') {
    const hours = Number(customHours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return new Error('Custom reminder hours must be greater than 0');
    }

    return { minutesBefore: Math.round(hours * 60) };
  }

  return { minutesBefore: Number(mode) };
}

function toReminderDraftFields(first?: number, second?: number) {
  const reminder1 = toReminderDraft(first);
  const reminder2 = toReminderDraft(second);

  return {
    reminder1Mode: reminder1.mode,
    reminder1CustomHours: reminder1.customHours,
    reminder2Mode: reminder2.mode,
    reminder2CustomHours: reminder2.customHours,
  };
}

function toReminderDraft(minutesBefore?: number): { mode: ReminderDraftMode; customHours: string } {
  if (!minutesBefore) {
    return { mode: 'none', customHours: '' };
  }

  const preset = REMINDER_OPTIONS.find((option) => option.value !== 'none' && Number(option.value) === minutesBefore);
  if (preset) {
    return { mode: preset.value, customHours: '' };
  }

  return {
    mode: 'custom',
    customHours: String(Number((minutesBefore / 60).toFixed(2))),
  };
}

function hydrateDraft(draft: EventDraft, members: Member[], calendars: Calendar[]) {
  return {
    ...draft,
    ownerMemberId: draft.ownerMemberId || members[0]?.id || '',
    calendarId: draft.calendarId || calendars[0]?.id || '',
  };
}

function toLocalInputValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function previousMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}

function nextMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 1);
}

function getEntryMutationId(entry: Entry): string {
  if (entry.parentEntryId) {
    return entry.parentEntryId;
  }

  const separatorIndex = entry.id.indexOf(':');
  return separatorIndex >= 0 ? entry.id.slice(0, separatorIndex) : entry.id;
}

function buildMonthGrid(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const offset = firstDay === 0 ? 6 : firstDay - 1;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: Array<number | null> = [];
  for (let index = 0; index < offset; index += 1) {
    days.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(day);
  }
  while (days.length % 7 !== 0) {
    days.push(null);
  }
  return days;
}

function getEntriesForDate(entries: Entry[], members: Member[], date: Date, searchQuery: string) {
  return entries.filter((entry) => sameDay(new Date(entry.startTime), date) && matchesSearch(entry, members, searchQuery));
}

function matchesSearch(entry: Entry, members: Member[], query: string) {
  if (!query.trim()) {
    return true;
  }
  const owner = members.find((member) => member.id === entry.ownerMemberId);
  const haystack = `${entry.title} ${entry.location ?? ''} ${owner?.name ?? ''} ${entry.type} ${entry.status}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate();
}

function isSameCalendarDate(left: Date | null, right: Date) {
  if (!left) {
    return false;
  }
  return sameDay(left, right);
}

function isToday(date: Date | null) {
  if (!date) {
    return false;
  }
  return sameDay(date, new Date());
}

function formatTimeRange(entry: Entry) {
  if (entry.allDay) {
    return 'All day';
  }
  return `${formatTime(entry.startTime)} - ${formatTime(entry.endTime)}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatUpcomingDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

function formatSelectedDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(value);
}

function formatStamp(value: string) {
  if (!value) {
    return 'unknown';
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}


function resolveWebSocketUrl() {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) {
    return configured;
  }
  if (typeof window === 'undefined') {
    return '';
  }
  return `ws://${window.location.hostname}:3000/ws`;
}

function applyTheme(mode: AppSettings['theme']['mode']) {
  if (typeof window === 'undefined') {
    return;
  }
  const root = document.documentElement;
  const resolved = mode === 'system'
    ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : mode;
  root.classList.toggle('dark', resolved === 'dark');
}
