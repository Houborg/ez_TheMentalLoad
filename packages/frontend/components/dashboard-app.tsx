'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
import type { AppSettings, AssistantDraft, DailyTimelineTemplateTask, Entry, Member, Calendar, ListTodayMemberTimelineResponse, MemberRole, MemberTimelineSettings, SyncProvider, TimelineTaskInstance } from '@mental-load/contracts';
import {
  askAssistant,
  connectSync,
  confirmAssistant,
  confirmTodayTimelineTask,
  createMember,
  createEntry,
  deleteCalendar,
  deleteMember,
  deleteEntry,
  listInvitationsForMember,
  loadAssistantStatus,
  loadMemberTimelineSettings,
  loadDashboardSnapshot,
  loadHealth,
  loadMembers,
  loadMonthOccurrences,
  loadSettings,
  loadTodayTimeline,
  loadWeatherForecast,
  loadUpcomingOccurrences,
  parseAssistant,
  pullInboxToMailpit,
  respondToInvitation,
  runSync,
  saveSettings,
  sendTestEmail,
  updateEntry,
  updateMember,
  updateMemberTimelineSettings,
  listMemberTimelineTemplates,
  createMemberTimelineTemplate,
  updateMemberTimelineTemplate,
  deleteMemberTimelineTemplate,
  deleteMemberTimelineTask,
  type WeatherForecastResponse,
} from '@/lib/api';
import { TodayTimelineBoard } from '@/components/today-timeline-board';
import { MobileNav } from '@/components/mobile-nav';
import { cn } from '@/lib/utils';

type ReminderDraftMode = 'none' | '5' | '10' | '60' | '120' | '1440' | '2880' | 'custom';
type RecurrenceFreq = 'none' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

type TaskDraftItem = {
  text: string;
  assignedToMemberId?: string;
};

type InviteeDraft = {
  type: 'member' | 'email';
  id?: string;
  email: string;
};

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
  recurrenceFreq: RecurrenceFreq;
  recurrenceCount: string;
  tasks: TaskDraftItem[];
  invitees: InviteeDraft[];
  reminder1Mode: ReminderDraftMode;
  reminder1CustomHours: string;
  reminder2Mode: ReminderDraftMode;
  reminder2CustomHours: string;
};

type TimelineQuickTaskDraft = {
  title: string;
  recurring: boolean;
  time: string;
  position: string;
  treat: string;
};

type NavSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

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
  const searchParams = useSearchParams();
  const [currentMonth, setCurrentMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [activeNav, setActiveNav] = useState<NavSection>('dashboard');
  const [dashboard, setDashboard] = useState<DashboardState>({ members: [], calendars: [], entries: [], reminderJobs: [] });
  const [monthOccurrences, setMonthOccurrences] = useState<Entry[]>([]);
  const [upcomingOccurrences, setUpcomingOccurrences] = useState<Entry[]>([]);
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
  const [memberFilterId, setMemberFilterId] = useState('');
  const [activeMemberId, setActiveMemberId] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('activeMemberId') ?? '';
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [deletingEntryId, setDeletingEntryId] = useState<string | null>(null);
  const [assistantSuggestionBusy, setAssistantSuggestionBusy] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'theme' | 'members' | 'calendars' | 'mail' | 'sync' | 'recurring' | 'birthdays' | 'weather' | 'developer'>('theme');
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const [updateMessage, setUpdateMessage] = useState('');
  const [serverVersion, setServerVersion] = useState<{ version: string; commit: string; deployedAt: string | null } | null>(null);
  const [remoteVersion, setRemoteVersion] = useState<{ sha: string; shortSha: string; message: string; date: string } | null | 'loading' | 'unavailable'>('unavailable');
  const [memberDraft, setMemberDraft] = useState<{ name: string; role: MemberRole; email: string; avatar: string }>({ name: '', role: 'parent', email: '', avatar: '' });
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [memberDeleteTarget, setMemberDeleteTarget] = useState<Member | null>(null);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [deletingCalendarId, setDeletingCalendarId] = useState<string | null>(null);
  const [mailActionBusy, setMailActionBusy] = useState(false);
  const [syncActionBusy, setSyncActionBusy] = useState(false);
  const [syncRunDraft, setSyncRunDraft] = useState({ calendarId: '', ownerMemberId: '', icsUrl: '', rawContent: '' });
  const [birthdaysDraft, setBirthdaysDraft] = useState<{ id?: string; name: string; date: string; memberId: string; notifyDaysBefore: number; wishes: string }>({ name: '', date: '', memberId: '', notifyDaysBefore: 7, wishes: '' });
  const [birthdayDetailEntry, setBirthdayDetailEntry] = useState<Entry | null>(null);
  const [birthdayWishesText, setBirthdayWishesText] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [weatherForecast, setWeatherForecast] = useState<WeatherForecastResponse | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [pendingInvitations, setPendingInvitations] = useState<Array<{ entry: Entry; invitee: { email: string; status: 'pending' | 'accepted' | 'declined' } }>>([]);
  const [respondingToInvitation, setRespondingToInvitation] = useState<{ entryId: string; email: string } | null>(null);
  const [celebrationTaskId, setCelebrationTaskId] = useState<string | undefined>();
  const [timelineSettingsByMemberId, setTimelineSettingsByMemberId] = useState<Record<string, MemberTimelineSettings>>({});
  const [todayTimelinesByMemberId, setTodayTimelinesByMemberId] = useState<Record<string, ListTodayMemberTimelineResponse>>({});
  const [loadingTodayTimelineMemberId, setLoadingTodayTimelineMemberId] = useState<string | null>(null);
  const [templatesByMemberId, setTemplatesByMemberId] = useState<Record<string, DailyTimelineTemplateTask[]>>({});
  const [expandedTemplatesMemberId, setExpandedTemplatesMemberId] = useState<string | null>(null);
  const [newTemplateDraft, setNewTemplateDraft] = useState<{ title: string; position: string; expectedTime: string; isMilestone: boolean; rewardText: string }>({
    title: '',
    position: '',
    expectedTime: '',
    isMilestone: false,
    rewardText: '',
  });
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateDraft, setEditingTemplateDraft] = useState<{ title: string; position: string; expectedTime: string; isMilestone: boolean; rewardText: string }>({
    title: '',
    position: '',
    expectedTime: '',
    isMilestone: false,
    rewardText: '',
  });
  const [timelineTaskDraftByMemberId, setTimelineTaskDraftByMemberId] = useState<Record<string, TimelineQuickTaskDraft>>({});
  const [editingTimelineTaskId, setEditingTimelineTaskId] = useState<string | null>(null);
  const [editingTimelineTaskDraft, setEditingTimelineTaskDraft] = useState<TimelineQuickTaskDraft>({ title: '', recurring: false, time: '', position: '', treat: '' });
  const [showConfetti, setShowConfetti] = useState(false);
  const [draft, setDraft] = useState<EventDraft>(() => createDefaultDraft());

  const navSectionFromQuery = useMemo<NavSection>(() => {
    const value = searchParams.get('section');
    if (value === 'dashboard' || value === 'planner' || value === 'timeline' || value === 'family' || value === 'settings') {
      return value;
    }
    return 'dashboard';
  }, [searchParams]);

  useEffect(() => {
    if (activeMemberId) {
      localStorage.setItem('activeMemberId', activeMemberId);
    }
  }, [activeMemberId]);

  useEffect(() => {
    setActiveNav(navSectionFromQuery);
    setSettingsOpen(navSectionFromQuery === 'settings');
  }, [navSectionFromQuery]);

  useEffect(() => {
    if (activeNav !== 'timeline' || dashboard.members.length === 0) {
      return;
    }

    void Promise.all(dashboard.members.map((member) => loadTodayTimelineForMember(member.id)));
  }, [activeNav, dashboard.members]);

  useEffect(() => {
    let active = true;

    async function loadAll() {
      try {
        setErrorText('');
        setRefreshing(true);
        const [dashboardSnapshot, monthEntries, upcoming, health, assistantStatus, settingsSnapshot] = await Promise.all([
          loadDashboardSnapshot(),
          loadMonthOccurrences(currentMonth),
          loadUpcomingOccurrences(30),
          loadHealth(),
          loadAssistantStatus(),
          loadSettings(),
        ]);

        const timelinePairs = await Promise.all(
          dashboardSnapshot.members.map(async (member) => {
            try {
              const config = await loadMemberTimelineSettings(member.id);
              return [member.id, config] as const;
            } catch {
              return [member.id, { memberId: member.id, enabled: false, maxTasksPerDay: 10, updatedAt: new Date().toISOString() }] as const;
            }
          }),
        );

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
        setActiveMemberId((current) => (
          dashboardSnapshot.members.some((member) => member.id === current)
            ? current
            : (dashboardSnapshot.members[0]?.id ?? '')
        ));
        setMonthOccurrences(monthEntries);
        setUpcomingOccurrences(upcoming);
        setHealthNow(health.now);
        setAssistantReady(assistantStatus.ok);
        setAssistantStatusText(assistantStatus.message);
        setTimelineSettingsByMemberId(Object.fromEntries(timelinePairs));
        setSettings(settingsSnapshot);
        setSyncRunDraft((current) => ({
          ...current,
          calendarId: current.calendarId || dashboardSnapshot.calendars[0]?.id || '',
          ownerMemberId: current.ownerMemberId || dashboardSnapshot.members[0]?.id || '',
        }));
        setDraft((currentDraft) => hydrateDraft(currentDraft, dashboardSnapshot.members, dashboardSnapshot.calendars));

        // Load pending invitations for the first member (in a real auth system, this would be the current user)
        if (dashboardSnapshot.members.length > 0) {
          const invitations = await listInvitationsForMember(dashboardSnapshot.members[0].id);
          if (active) {
            setPendingInvitations(invitations);
          }
        }
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
  const activeMember = dashboard.members.find((member) => member.id === activeMemberId) ?? dashboard.members[0];
  const canManageMembers = activeMember?.role === 'parent';

  const birthdays = useMemo(() => parseBirthdays(settings?.sync.configJson.birthdays), [settings?.sync.configJson.birthdays]);
  const recurringDefaults = useMemo(() => parseRecurringDefaults(settings?.sync.configJson.recurringDefaults), [settings?.sync.configJson.recurringDefaults]);

  const birthdayMonthOccurrences = useMemo(
    () => buildBirthdayOccurrencesInRange(birthdays, startOfMonth(currentMonth), endOfMonth(currentMonth), dashboard.calendars[0]?.id, dashboard.members[0]?.id),
    [birthdays, currentMonth, dashboard.calendars, dashboard.members],
  );

  const birthdayUpcomingOccurrences = useMemo(() => {
    const from = new Date();
    const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
    return buildBirthdayOccurrencesInRange(birthdays, from, to, dashboard.calendars[0]?.id, dashboard.members[0]?.id);
  }, [birthdays, dashboard.calendars, dashboard.members]);

  const monthEntriesForView = useMemo(
    () => [...monthOccurrences, ...birthdayMonthOccurrences].sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [birthdayMonthOccurrences, monthOccurrences],
  );

  const upcomingEntriesForView = useMemo(
    () => [...upcomingOccurrences, ...birthdayUpcomingOccurrences].sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [birthdayUpcomingOccurrences, upcomingOccurrences],
  );

  const filteredUpcoming = useMemo(() => {
    return upcomingEntriesForView
      .filter((entry) => entry.type !== 'task')
      .filter((entry) => matchesMemberFilter(entry, memberFilterId))
      .filter((entry) => matchesSearch(entry, dashboard.members, searchQuery))
      .sort((left, right) => left.startTime.localeCompare(right.startTime))
      .slice(0, 8);
  }, [dashboard.members, memberFilterId, searchQuery, upcomingEntriesForView]);

  const selectedEntries = useMemo(() => {
    return monthEntriesForView
      .filter((entry) => sameDay(new Date(entry.startTime), selectedDate))
      .filter((entry) => matchesMemberFilter(entry, memberFilterId))
      .filter((entry) => matchesSearch(entry, dashboard.members, searchQuery))
      .sort((left, right) => left.startTime.localeCompare(right.startTime));
  }, [dashboard.members, memberFilterId, monthEntriesForView, searchQuery, selectedDate]);

  const statCards = useMemo(() => {
    const today = new Date();
    const nextWeekBoundary = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const upcomingTaskCount = countTasks(upcomingEntriesForView.filter((entry) => new Date(entry.startTime) <= nextWeekBoundary));

    return [
      {
        label: 'Monthly events',
        value: String(monthEntriesForView.filter((entry) => entry.type === 'event').length),
        subtext: `${MONTHS[currentMonth.getMonth()]} overview`,
        icon: CalendarDays,
        color: 'text-primary bg-primary/12',
      },
      {
        label: 'Tasks next 7 days',
        value: String(upcomingTaskCount),
        subtext: 'Upcoming task count',
        icon: CheckCircle2,
        color: 'text-chart-2 bg-chart-2/12',
      },
      {
        label: 'Events next 7 days',
        value: String(upcomingEntriesForView.filter((entry) => entry.type === 'event' && new Date(entry.startTime) <= nextWeekBoundary).length),
        subtext: 'Recurring included',
        icon: Clock3,
        color: 'text-chart-3 bg-chart-3/12',
      },
    ];
  }, [currentMonth, monthEntriesForView, upcomingEntriesForView]);

  const taskProgress = useMemo(() => {
    const summary = summarizeTasks(dashboard.entries);
    const done = summary.done;
    const total = summary.total;
    return { done, pending: total - done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
  }, [dashboard.entries]);

  const memberTaskProgress = useMemo(() => {
    return dashboard.members
      .map((member) => {
        const summary = summarizeTasks(dashboard.entries, member.id);
        const pending = summary.total - summary.done;
        const pct = summary.total > 0 ? Math.round((summary.done / summary.total) * 100) : 0;
        return {
          member,
          done: summary.done,
          pending,
          total: summary.total,
          pct,
        };
      })
      .sort((left, right) => right.total - left.total);
  }, [dashboard.entries, dashboard.members]);

  const monthDays = useMemo(() => buildMonthGrid(currentMonth), [currentMonth]);

  const recurringEntries = useMemo(
    () => monthEntriesForView.filter((entry) => Boolean(entry.recurrenceRule) && !isVirtualBirthdayEntry(entry)).sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [monthEntriesForView],
  );

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

  async function handleToggleChecklistItem(entry: Entry, itemId: string) {
    try {
      setErrorText('');
      const updatedChecklist = entry.checklist.map((item) =>
        item.id === itemId ? { ...item, isCompleted: !item.isCompleted } : item,
      );
      await updateEntry(getEntryMutationId(entry), {
        checklist: updatedChecklist.map((item) => ({
          text: item.text,
          isCompleted: item.isCompleted,
          assignedToMemberId: item.assignedToMemberId,
        })),
      });
      await handleRefresh();
      await refreshTimelinesIfVisible();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update checklist item');
    }
  }

  async function handleRefresh() {
    setCurrentMonth((current) => new Date(current));
  }

  async function refreshTimelinesIfVisible() {
    if (activeNav !== 'timeline' || dashboard.members.length === 0) {
      return;
    }

    await Promise.all(dashboard.members.map((member) => loadTodayTimelineForMember(member.id)));
  }

  async function handleCreateEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reminders = buildReminderPayload(draft);
    if (reminders instanceof Error) {
      setErrorText(reminders.message);
      return;
    }

    if (!draft.calendarId) {
      setErrorText('No calendar available. Create a member first — each member gets their own calendar.');
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
        recurrenceRule: buildRecurrenceRule(draft.recurrenceFreq, draft.recurrenceCount) || undefined,
        reminders,
        checklist: draft.tasks
          .map((task) => ({ text: task.text, isCompleted: false, assignedToMemberId: task.assignedToMemberId }))
          .filter((item) => item.text.trim()),
        invitees: draft.invitees.map((inv) => ({ email: inv.email })),
        assignedToMemberId: undefined,
      };

      if (editingEntryId) {
        await updateEntry(editingEntryId, payload);
      } else {
        await createEntry(payload);
      }

      closeEntryComposer();
      await handleRefresh();
      await refreshTimelinesIfVisible();
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

    if (section === 'dashboard' || section === 'timeline' || section === 'family' || section === 'settings') {
      router.replace(`/?section=${section}`);
    }

    if (section === 'settings') {
      setSettingsOpen(true);
      return;
    }

    if (section === 'planner') {
      router.push('/planner');
      return;
    }

    if (section === 'family') {
      return;
    }

    if (section === 'timeline') {
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
      await refreshTimelinesIfVisible();
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

  async function handleRespondToInvitation(entryId: string, email: string, status: 'accepted' | 'declined') {
    try {
      setRespondingToInvitation({ entryId, email });
      await respondToInvitation(entryId, email, status);
      setPendingInvitations((current) => current.filter((inv) => !(inv.entry.id === entryId && inv.invitee.email === email)));
      setErrorText('');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not respond to invitation');
    } finally {
      setRespondingToInvitation(null);
    }
  }

  function handleEditEntry(entry: Entry) {
    if (isVirtualBirthdayEntry(entry)) {
      const info = getBirthdayInfo(entry, birthdays);
      setBirthdayDetailEntry(entry);
      setBirthdayWishesText(info?.birthday.wishes ?? '');
      return;
    }

    setEditingEntryId(getEntryMutationId(entry));
    const [firstReminder, secondReminder] = entry.reminders;
    const { freq, count } = parseRecurrenceRule(entry.recurrenceRule);
    setDraft({
      title: entry.title,
      type: entry.type,
      ownerMemberId: entry.ownerMemberId,
      calendarId: entry.calendarId,
      startTime: toLocalInputValue(new Date(entry.startTime)),
      endTime: toLocalInputValue(new Date(entry.endTime)),
      allDay: entry.allDay,
      location: entry.location || '',
      recurrenceFreq: freq,
      recurrenceCount: count,
      tasks: entry.checklist.map((item) => ({ text: item.text, assignedToMemberId: item.assignedToMemberId })),
      invitees: entry.invitees.map((inv) => {
        const knownMember = dashboard.members.find((m) => m.email?.toLowerCase() === inv.email.toLowerCase());
        return {
          type: knownMember ? 'member' : 'email',
          id: knownMember?.id,
          email: inv.email,
        } as InviteeDraft;
      }),
      ...toReminderDraftFields(firstReminder?.minutesBefore, secondReminder?.minutesBefore),
    });
    setSelectedDate(new Date(entry.startTime));
    setIsComposerOpen(true);
  }

  function openCreateEntryComposer(input?: { date?: Date; ownerMemberId?: string }) {
    const nextDate = input?.date ?? new Date();
    const seededDraft = applyRecurringDefaultsToDraft(
      createDefaultDraft(
        input?.ownerMemberId ?? dashboard.members[0]?.id ?? '',
        dashboard.calendars[0]?.id ?? '',
        nextDate,
      ),
      recurringDefaults,
    );
    const nextDraft = hydrateDraft(
      seededDraft,
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
    setDraft(applyRecurringDefaultsToDraft(createDefaultDraft(dashboard.members[0]?.id, dashboard.calendars[0]?.id), recurringDefaults));
  }

  async function refreshMembers() {
    const members = await loadMembers();
    setDashboard((current) => ({ ...current, members }));
    setActiveMemberId((current) => (members.some((member) => member.id === current) ? current : (members[0]?.id ?? '')));
    setSyncRunDraft((current) => ({
      ...current,
      ownerMemberId: members.some((member) => member.id === current.ownerMemberId) ? current.ownerMemberId : members[0]?.id || '',
    }));

    const timelinePairs = await Promise.all(
      members.map(async (member) => {
        try {
          const config = await loadMemberTimelineSettings(member.id);
          return [member.id, config] as const;
        } catch {
          return [member.id, { memberId: member.id, enabled: false, maxTasksPerDay: 10, updatedAt: new Date().toISOString() }] as const;
        }
      }),
    );
    setTimelineSettingsByMemberId(Object.fromEntries(timelinePairs));
    setTodayTimelinesByMemberId((current) => {
      const next: Record<string, ListTodayMemberTimelineResponse> = {};
      for (const member of members) {
        if (current[member.id]) {
          next[member.id] = current[member.id];
        }
      }
      return next;
    });
  }

  async function loadTodayTimelineForMember(memberId: string) {
    setLoadingTodayTimelineMemberId(memberId);
    try {
      const result = await loadTodayTimeline(memberId);
      setTodayTimelinesByMemberId((prev) => ({ ...prev, [memberId]: result }));
      return result;
    } catch {
      const fallback: ListTodayMemberTimelineResponse = {
        settings: timelineSettingsByMemberId[memberId] ?? {
          memberId,
          enabled: false,
          maxTasksPerDay: 10,
          updatedAt: new Date().toISOString(),
        },
        timeline: {
          memberId,
          date: new Date().toISOString().slice(0, 10),
          timezone: 'UTC',
          tasks: [],
        },
      };
      setTodayTimelinesByMemberId((prev) => ({ ...prev, [memberId]: fallback }));
      return fallback;
    } finally {
      setLoadingTodayTimelineMemberId((current) => (current === memberId ? null : current));
    }
  }

  async function handleConfirmDeleteMember() {
    if (!memberDeleteTarget) {
      return;
    }
    const targetMember = memberDeleteTarget;

    try {
      setErrorText('');
      setDeletingMemberId(targetMember.id);
      await deleteMember(targetMember.id, { actorMemberId: activeMember?.id });
      await refreshMembers();
      setTimelineSettingsByMemberId((current) => {
        const next = { ...current };
        delete next[targetMember.id];
        return next;
      });
      setTodayTimelinesByMemberId((current) => {
        const next = { ...current };
        delete next[targetMember.id];
        return next;
      });
      setTemplatesByMemberId((current) => {
        const next = { ...current };
        delete next[targetMember.id];
        return next;
      });
      setExpandedTemplatesMemberId((current) => (current === targetMember.id ? null : current));

      if (editingMemberId === targetMember.id) {
        setEditingMemberId(null);
        setMemberDraft({ name: '', role: 'parent', email: '', avatar: '' });
      }

      setSettingsMessage(`Member "${targetMember.name}" deleted.`);
      setMemberDeleteTarget(null);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete member');
    } finally {
      setDeletingMemberId(null);
    }
  }

  async function handleDeleteCalendar(id: string) {
    try {
      setDeletingCalendarId(id);
      await deleteCalendar(id);
      setDashboard((prev) => ({ ...prev, calendars: prev.calendars.filter((c) => c.id !== id) }));
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete calendar');
    } finally {
      setDeletingCalendarId(null);
    }
  }

  async function handleUpdateTimelineSettings(memberId: string, patch: { enabled?: boolean; maxTasksPerDay?: number }) {
    try {
      setErrorText('');
      const updated = await updateMemberTimelineSettings(memberId, patch);
      setTimelineSettingsByMemberId((current) => ({
        ...current,
        [memberId]: updated,
      }));
      await loadTodayTimelineForMember(memberId);
      setSettingsMessage('Timeline settings updated.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update timeline settings');
    }
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
          avatar: memberDraft.avatar.trim() || undefined,
        });
      } else {
        await createMember({
          name,
          role: memberDraft.role,
          email: memberDraft.email.trim() || undefined,
          avatar: memberDraft.avatar.trim() || undefined,
        });
      }

      await refreshMembers();
      setMemberDraft({ name: '', role: 'parent', email: '', avatar: '' });
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
      avatar: member.avatar ?? '',
    });
  }

  async function handleToggleMemberTimeline(memberId: string) {
    const current = timelineSettingsByMemberId[memberId];
    const nextEnabled = !current?.enabled;
    try {
      const updated = await updateMemberTimelineSettings(memberId, { enabled: nextEnabled });
      setTimelineSettingsByMemberId((prev) => ({ ...prev, [memberId]: updated }));
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update timeline settings');
    }
  }

  async function loadTemplatesForMember(memberId: string) {
    try {
      const result = await listMemberTimelineTemplates(memberId);
      setTemplatesByMemberId((prev) => ({ ...prev, [memberId]: result.templates }));
    } catch {
      // silently ignore
    }
  }

  async function handleDeleteTodayTimelineTask(memberId: string, taskId: string) {
    try {
      await deleteMemberTimelineTask(memberId, taskId);
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete timeline task');
    }
  }

  async function handleConfirmTodayTimelineTask(memberId: string, taskId: string) {
    try {
      const result = await confirmTodayTimelineTask(memberId, { taskId });
      setTodayTimelinesByMemberId((current) => ({
        ...current,
        [memberId]: {
          ...(current[memberId] ?? { settings: { memberId, enabled: true, maxTasksPerDay: 10, updatedAt: new Date().toISOString() } }),
          timeline: result.timeline,
        },
      }));
      setCelebrationTaskId(taskId);
      const confirmed = result.timeline.tasks.find((task) => task.id === taskId);
      if (confirmed?.rewardText) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 1800);
      }
      setTimeout(() => setCelebrationTaskId(undefined), 1400);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not confirm timeline task');
    }
  }

  function handleOpenTimelineTask(task: TimelineTaskInstance) {
    const linkedEntryId = task.linkedEntryId?.split('#')[0];
    if (!linkedEntryId) {
      return;
    }

    const entry = dashboard.entries.find((item) => getEntryMutationId(item) === linkedEntryId);
    if (!entry) {
      return;
    }

    handleEditEntry(entry);
  }

  function getMemberCalendarId(memberId: string): string {
    return dashboard.calendars.find((calendar) => calendar.ownerMemberId === memberId)?.id
      ?? dashboard.calendars[0]?.id
      ?? '';
  }

  function getTimelineTaskDraft(memberId: string): TimelineQuickTaskDraft {
    return timelineTaskDraftByMemberId[memberId] ?? { title: '', recurring: false, time: '', position: '', treat: '' };
  }

  function setTimelineTaskDraft(memberId: string, patch: Partial<TimelineQuickTaskDraft>) {
    setTimelineTaskDraftByMemberId((current) => {
      const previous = current[memberId] ?? { title: '', recurring: false, time: '', position: '', treat: '' };
      return {
        ...current,
        [memberId]: {
          ...previous,
          ...patch,
        },
      };
    });
  }

  function buildTimelineTaskSchedule(date: string, timeValue: string, positionValue: string): { startTime: string; endTime: string } {
    const normalized = normalizeTemplateExpectedTime(timeValue) ?? '09:00';
    const [hoursRaw, minutesRaw] = normalized.split(':');
    const hours = Number(hoursRaw ?? '9');
    const minutes = Number(minutesRaw ?? '0');
    const position = Math.max(0, Number(positionValue) || 0);

    const start = new Date(`${date}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);
    if (!Number.isNaN(start.getTime()) && position > 0) {
      start.setSeconds(Math.min(position - 1, 59));
    }

    const end = new Date(start.getTime() + (30 * 60 * 1000));
    return {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
    };
  }

  function extractTreatFromEntryLocation(location?: string): string {
    if (!location) {
      return '';
    }
    const trimmed = location.trim();
    if (!trimmed.toUpperCase().startsWith('TREAT:')) {
      return '';
    }
    return trimmed.slice(6).trim();
  }

  async function handleAddTimelineTask(memberId: string) {
    const draft = getTimelineTaskDraft(memberId);
    const title = draft.title.trim();
    if (!title) {
      setErrorText('Task name is required');
      return;
    }

    if (draft.time.trim() && !normalizeTemplateExpectedTime(draft.time)) {
      setErrorText('Task time must be in HH:MM format');
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const schedule = buildTimelineTaskSchedule(date, draft.time, draft.position);
    const treat = draft.treat.trim();

    const calendarId = getMemberCalendarId(memberId);
    if (!calendarId) {
      setErrorText('No calendar found for this member. Create a member first — each member gets their own calendar.');
      return;
    }

    try {
      await createEntry({
        title,
        type: 'task',
        ownerMemberId: memberId,
        calendarId,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        timezone: 'UTC',
        allDay: false,
        reminders: [],
        recurrenceRule: draft.recurring ? 'FREQ=DAILY' : undefined,
        location: treat ? `TREAT:${treat}` : undefined,
      });

      setTimelineTaskDraftByMemberId((current) => ({
        ...current,
        [memberId]: { title: '', recurring: false, time: '', position: '', treat: '' },
      }));
      await handleRefresh();
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not add timeline task');
    }
  }

  function handleStartEditTimelineTask(entry: Entry) {
    setEditingTimelineTaskId(entry.id);
    const start = new Date(entry.startTime);
    const hh = Number.isNaN(start.getTime()) ? '' : `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;
    const pos = Number.isNaN(start.getTime()) ? '' : String(start.getSeconds() > 0 ? start.getSeconds() + 1 : 0);
    setEditingTimelineTaskDraft({
      title: entry.title,
      recurring: Boolean(entry.recurrenceRule),
      time: hh,
      position: pos,
      treat: extractTreatFromEntryLocation(entry.location),
    });
  }

  function handleCancelEditTimelineTask() {
    setEditingTimelineTaskId(null);
    setEditingTimelineTaskDraft({ title: '', recurring: false, time: '', position: '', treat: '' });
  }

  async function handleSaveTimelineTask(memberId: string, entryId: string) {
    const title = editingTimelineTaskDraft.title.trim();
    if (!title) {
      setErrorText('Task name is required');
      return;
    }
    if (editingTimelineTaskDraft.time.trim() && !normalizeTemplateExpectedTime(editingTimelineTaskDraft.time)) {
      setErrorText('Task time must be in HH:MM format');
      return;
    }

    const date = new Date().toISOString().slice(0, 10);
    const schedule = buildTimelineTaskSchedule(date, editingTimelineTaskDraft.time, editingTimelineTaskDraft.position);
    const previous = dashboard.entries.find((entry) => entry.id === entryId);
    const previousTreat = extractTreatFromEntryLocation(previous?.location);
    const location = editingTimelineTaskDraft.treat.trim()
      ? `TREAT:${editingTimelineTaskDraft.treat.trim()}`
      : (previousTreat ? undefined : previous?.location);

    try {
      await updateEntry(entryId, {
        title,
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        recurrenceRule: editingTimelineTaskDraft.recurring ? 'FREQ=DAILY' : undefined,
        location,
      });
      handleCancelEditTimelineTask();
      await handleRefresh();
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not save task changes');
    }
  }

  async function handleExpandTemplates(memberId: string) {
    if (expandedTemplatesMemberId === memberId) {
      setExpandedTemplatesMemberId(null);
      return;
    }
    setExpandedTemplatesMemberId(memberId);
    await loadTodayTimelineForMember(memberId);
  }

  async function handleAddTemplate(memberId: string) {
    const pos = Number(newTemplateDraft.position) || ((templatesByMemberId[memberId]?.length ?? 0) + 1);
    const expTime = normalizeTemplateExpectedTime(newTemplateDraft.expectedTime);
    const rewardText = newTemplateDraft.rewardText.trim();
    if (!newTemplateDraft.title.trim()) return;
    if (newTemplateDraft.expectedTime.trim() && !expTime) {
      setErrorText('Task time must be in HH:MM format');
      return;
    }
    try {
      await createMemberTimelineTemplate(memberId, {
        title: newTemplateDraft.title.trim(),
        position: pos,
        expectedTime: expTime,
        isActive: true,
        isMilestone: newTemplateDraft.isMilestone || Boolean(rewardText),
        rewardText: rewardText || undefined,
      });
      setNewTemplateDraft({ title: '', position: '', expectedTime: '', isMilestone: false, rewardText: '' });
      await loadTemplatesForMember(memberId);
      await loadTodayTimelineForMember(memberId);
      setSettingsMessage('Template task created.');
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not create template task');
    }
  }

  async function handleDeleteTemplate(memberId: string, templateId: string) {
    try {
      await deleteMemberTimelineTemplate(memberId, templateId);
      setTemplatesByMemberId((prev) => ({ ...prev, [memberId]: (prev[memberId] ?? []).filter((t) => t.id !== templateId) }));
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not delete template task');
    }
  }

  async function handleToggleTemplateActive(memberId: string, templateId: string, isActive: boolean) {
    try {
      await updateMemberTimelineTemplate(memberId, templateId, { isActive: !isActive });
      setTemplatesByMemberId((prev) => ({
        ...prev,
        [memberId]: (prev[memberId] ?? []).map((t) => t.id === templateId ? { ...t, isActive: !isActive } : t),
      }));
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update template task');
    }
  }

  function handleStartEditTemplate(template: DailyTimelineTemplateTask) {
    setEditingTemplateId(template.id);
    setEditingTemplateDraft({
      title: template.title,
      position: String(template.position),
      expectedTime: template.expectedTime || '',
      isMilestone: template.isMilestone,
      rewardText: template.rewardText || '',
    });
  }

  function handleCancelEditTemplate() {
    setEditingTemplateId(null);
    setEditingTemplateDraft({ title: '', position: '', expectedTime: '', isMilestone: false, rewardText: '' });
  }

  async function handleSaveEditTemplate(memberId: string, templateId: string) {
    const title = editingTemplateDraft.title.trim();
    if (!title) {
      setErrorText('Task title is required');
      return;
    }
    const pos = Number(editingTemplateDraft.position) || 1;
    const expTime = editingTemplateDraft.expectedTime.trim() ? normalizeTemplateExpectedTime(editingTemplateDraft.expectedTime) : undefined;
    const rewardText = editingTemplateDraft.rewardText.trim();
    if (editingTemplateDraft.expectedTime.trim() && !expTime) {
      setErrorText('Task time must be in HH:MM format');
      return;
    }
    try {
      await updateMemberTimelineTemplate(memberId, templateId, {
        title,
        position: pos,
        expectedTime: expTime,
        isMilestone: editingTemplateDraft.isMilestone || Boolean(rewardText),
        rewardText: rewardText || undefined,
      });
      setTemplatesByMemberId((prev) => ({
        ...prev,
        [memberId]: (prev[memberId] ?? []).map((t) =>
          t.id === templateId ? {
            ...t,
            title,
            position: pos,
            expectedTime: expTime,
            isMilestone: editingTemplateDraft.isMilestone || Boolean(rewardText),
            rewardText: rewardText || undefined,
          } : t
        ),
      }));
      await loadTodayTimelineForMember(memberId);
      handleCancelEditTemplate();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not update template task');
    }
  }

  const DEFAULT_TEMPLATE_TASKS = [
    'Wake up', 'Brush teeth', 'Get dressed', 'Eat breakfast', 'School / work',
    'Empty bag', 'Do homework', 'Do chores', 'Get ready for bed', 'Brush teeth & sleep',
  ];

  async function handleSeedDefaultTemplates(memberId: string) {
    try {
      for (let i = 0; i < DEFAULT_TEMPLATE_TASKS.length; i++) {
        await createMemberTimelineTemplate(memberId, { title: DEFAULT_TEMPLATE_TASKS[i]!, position: i + 1, isActive: true });
      }
      await loadTemplatesForMember(memberId);
      await loadTodayTimelineForMember(memberId);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Could not seed template tasks');
    }
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

  async function handleSaveRecurringDefaults(defaults: { enabled: boolean; freq: RecurrenceFreq; count: string }) {
    const parsedCount = Number(defaults.count);
    const nextDefaults = {
      enabled: defaults.enabled,
      freq: defaults.enabled ? defaults.freq : 'none',
      count: defaults.enabled && Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : undefined,
    };

    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      recurringDefaults: nextDefaults,
    }, 'Recurring creation defaults saved.');
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
        memberId: undefined,
        notifyDaysBefore: birthdaysDraft.notifyDaysBefore,
        wishes: birthdaysDraft.wishes.trim() || undefined,
      },
    ].sort((left, right) => left.date.localeCompare(right.date));

    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      birthdays: nextBirthdays,
    }, birthdaysDraft.id ? 'Birthday updated.' : 'Birthday added.');

    setBirthdaysDraft({ name: '', date: '', memberId: '', notifyDaysBefore: 7, wishes: '' });
  }

  async function handleDeleteBirthday(id: string) {
    const nextBirthdays = birthdays.filter((item) => item.id !== id);
    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      birthdays: nextBirthdays,
    }, 'Birthday removed.');
  }

  async function handleSaveBirthdayWishes() {
    if (!birthdayDetailEntry) return;
    const info = getBirthdayInfo(birthdayDetailEntry, birthdays);
    if (!info) return;
    const nextBirthdays = birthdays.map((b) =>
      b.id === info.birthday.id ? { ...b, wishes: birthdayWishesText.trim() || undefined } : b,
    );
    await persistSyncConfig({ ...(settings?.sync.configJson ?? {}), birthdays: nextBirthdays }, 'Wishes saved.');
    setBirthdayDetailEntry(null);
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
      wishes: item.wishes ?? '',
    });
  }

  async function handleSaveWeather(config: { location: string; state: string; country: string; unit: 'C' | 'F'; updateFrequencyMinutes: number }) {
    await persistSyncConfig({
      ...(settings?.sync.configJson ?? {}),
      weather: config,
    }, 'Weather settings saved.');
  }

  async function handleForceUpdate() {
    try {
      setUpdateInProgress(true);
      setUpdateMessage('');
      const response = await fetch('/api/update', { method: 'POST' });
      const contentType = response.headers.get('content-type') ?? '';
      const data = contentType.includes('application/json')
        ? (await response.json()) as { ok?: boolean; message?: string }
        : undefined;
      if (!response.ok) {
        if (response.status === 401) {
          setUpdateMessage('Error: Session expired. Please log in again.');
          return;
        }

        const fallbackText = data?.message ?? (await response.text()).trim();
        setUpdateMessage(`Error: ${fallbackText || 'Update failed'}`);
      } else {
        setUpdateMessage(data?.message ?? 'Deploy triggered. Check server logs for progress.');
        // Re-fetch server version after a short delay to confirm the update was applied.
        setTimeout(() => { void fetchServerVersion(); }, 5000);
      }
    } catch (error) {
      setUpdateMessage(`Failed to trigger update: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setUpdateInProgress(false);
    }
  }

  async function fetchServerVersion() {
    try {
      const res = await fetch('/api/v1/health', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as { version?: string; commit?: string; deployedAt?: string | null };
        setServerVersion({
          version: data.version ?? '0.0.0-dev',
          commit: data.commit ?? 'local',
          deployedAt: data.deployedAt ?? null,
        });
      }
    } catch {
      // ignore
    }
  }

  async function fetchRemoteVersion() {
    setRemoteVersion('loading');
    try {
      const res = await fetch('/api/version/remote', { cache: 'no-store' });
      if (!res.ok) { setRemoteVersion('unavailable'); return; }
      const data = (await res.json()) as { sha?: string; message?: string; date?: string };
      if (!data.sha) { setRemoteVersion('unavailable'); return; }
      setRemoteVersion({
        sha: data.sha,
        shortSha: data.sha.slice(0, 7),
        message: data.message ?? '',
        date: data.date ?? '',
      });
    } catch {
      setRemoteVersion('unavailable');
    }
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
      <MobileNav activeSection={activeNav} />
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar/80 py-5 backdrop-blur transition-all duration-300 flex-col',
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
              { label: 'Timeline', icon: CheckCircle2, key: 'timeline' },
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
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    setActiveMemberId(member.id);
                    router.push(`/member/${encodeURIComponent(member.id)}`);
                  }}
                  className={cn(
                    'flex w-full rounded-2xl py-2.5 text-left hover:bg-sidebar-accent/60',
                    activeMember?.id === member.id && 'bg-sidebar-accent/60',
                    isSidebarCollapsed ? 'justify-center px-1' : 'items-center gap-3 px-3',
                  )}
                  title={isSidebarCollapsed ? `${member.name} (${member.role})` : undefined}
                >
                  <div className={cn('flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground', memberColorById[member.id] ?? 'bg-primary')}>
                    {member.avatar ? <span className="text-xl">{member.avatar}</span> : <Users className="h-5 w-5" />}
                  </div>
                  {!isSidebarCollapsed ? (
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{member.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{member.role}</div>
                    </div>
                  ) : null}
                </button>
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
            <label className="hidden min-w-[180px] lg:block">
              <span className="sr-only">Filter member</span>
              <select
                aria-label="Filter by member"
                value={memberFilterId}
                onChange={(event) => setMemberFilterId(event.target.value)}
                className="h-11 w-full rounded-2xl border border-border/60 bg-background/60 px-3 text-sm outline-none transition focus:border-primary/60"
              >
                <option value="">All members</option>
                {dashboard.members.map((member) => (
                  <option key={member.id} value={member.id}>{member.name}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border/60 bg-background/60 text-muted-foreground transition hover:text-foreground"
              aria-label="Refresh dashboard"
            >
              <RefreshCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
              <label className="hidden items-center gap-2 lg:flex" title="Signed in as">
                <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-primary-foreground', memberColorById[activeMember?.id ?? ''] ?? 'bg-primary')}>
                  {activeMember?.avatar ? <span className="text-base">{activeMember.avatar}</span> : <Users className="h-4 w-4" />}
                </div>
                <select
                  aria-label="Signed in as"
                  value={activeMember?.id ?? ''}
                  onChange={(event) => setActiveMemberId(event.target.value)}
                  className="h-9 rounded-2xl border border-border/60 bg-background/60 px-3 text-sm outline-none transition focus:border-primary/60"
                >
                  {dashboard.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name} ({member.role})
                    </option>
                  ))}
                </select>
              </label>
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

          <section className="flex-1 overflow-auto px-4 py-6 pb-20 md:px-6 md:pb-6">
            {activeNav !== 'family' && activeNav !== 'timeline' ? (
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
              <div id="hero-section" className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs uppercase tracking-[0.22em] text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    Version 1.0.0
                  </div>
                  <h1 className="text-3xl font-bold tracking-tight">Family operations dashboard</h1>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground md:text-base">
                    The base of operations. Everything at a glance.
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
                {/* Task progress card */}
                <div className="panel-surface rounded-[28px] border border-border/60 p-5 shadow-xl shadow-black/10">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Task progress</div>
                      <div className="mt-3 text-3xl font-semibold tracking-tight">{taskProgress.done}<span className="text-lg text-muted-foreground">/{taskProgress.total}</span></div>
                      <div className="mt-1 text-sm text-muted-foreground">{taskProgress.pending} not finished</div>
                      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-chart-5 transition-all duration-500"
                          style={{ width: `${taskProgress.pct}%` }}
                        />
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{taskProgress.pct}% complete</div>
                    </div>
                    <div className="rounded-2xl p-3 text-chart-5 bg-chart-5/12">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  </div>
                </div>
              </div>

              <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">Task tracking by member</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Assigned tasks and completion per member.</p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {memberTaskProgress.map(({ member, done, pending, total, pct }) => (
                    <div key={member.id} className="rounded-2xl border border-border/60 bg-background/30 p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground', memberColorById[member.id] ?? 'bg-primary')}>
                          {member.avatar ? <span className="text-sm">{member.avatar}</span> : <Users className="h-4 w-4" />}
                        </div>
                        <div>
                          <div className="text-sm font-semibold">{member.name}</div>
                          <div className="text-[11px] capitalize text-muted-foreground">{member.role}</div>
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground">{done}/{total} complete</div>
                      <div className="text-xs text-muted-foreground">{pending} pending</div>
                      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-chart-2 transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {pendingInvitations.length > 0 ? (
                <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold">Pending invitations</h2>
                      <p className="mt-1 text-sm text-muted-foreground">You have {pendingInvitations.length} pending event invitation{pendingInvitations.length === 1 ? '' : 's'}.</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {pendingInvitations.map(({ entry, invitee }) => (
                      <div key={`${entry.id}-${invitee.email}`} className="rounded-2xl border border-border/60 bg-background/30 p-4">
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="font-semibold">{entry.title}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {new Date(entry.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                              {!entry.allDay ? ` at ${new Date(entry.startTime).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ' (all day)'}
                            </div>
                            {entry.location ? <div className="mt-1 text-sm text-muted-foreground">📍 {entry.location}</div> : null}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleRespondToInvitation(entry.id, invitee.email, 'accepted')}
                            disabled={respondingToInvitation?.entryId === entry.id}
                            className="rounded-lg bg-primary/15 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/25 disabled:opacity-60"
                          >
                            {respondingToInvitation?.entryId === entry.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : 'Accept'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRespondToInvitation(entry.id, invitee.email, 'declined')}
                            disabled={respondingToInvitation?.entryId === entry.id}
                            className="rounded-lg border border-border/60 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent/60 disabled:opacity-60"
                          >
                            {respondingToInvitation?.entryId === entry.id ? <LoaderCircle className="h-3 w-3 animate-spin" /> : 'Decline'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

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

                  <div className="overflow-x-auto -mx-1 px-1"><div className="min-w-[420px]"><div className="grid grid-cols-7 gap-px overflow-hidden rounded-[24px] border border-border/60 bg-border/60">
                    {DAYS.map((day) => (
                      <div key={day} className="bg-card px-3 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                        {day}
                      </div>
                    ))}
                    {monthDays.map((day, index) => {
                      const date = day ? new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day) : null;
                      const entries = date ? getEntriesForDate(monthEntriesForView, dashboard.members, date, searchQuery, memberFilterId) : [];
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
                                {entries.slice(0, 3).map((entry) => {
                                  const isBirthdayEntry = isVirtualBirthdayEntry(entry);
                                  const birthdayInfo = isBirthdayEntry ? getBirthdayInfo(entry, birthdays) : null;
                                  return (
                                    <button
                                      key={entry.id}
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        handleEditEntry(entry);
                                      }}
                                      className={cn(
                                        isBirthdayEntry
                                          ? 'w-full bg-transparent px-0 py-0.5 text-left text-[10px] font-medium text-foreground hover:bg-transparent'
                                          : `w-full truncate rounded-xl px-2 py-1 text-left text-xs font-medium text-primary-foreground ${memberColorById[entry.ownerMemberId] ?? 'bg-primary'}`,
                                      )}
                                    >
                                      {isBirthdayEntry ? (
                                        <span className="flex min-w-0 items-center gap-1.5">
                                          <span
                                            aria-hidden="true"
                                            className="h-3.5 w-5 shrink-0 bg-contain bg-center bg-no-repeat"
                                            style={{ backgroundImage: 'url(/birthday-pill.png)' }}
                                          />
                                          <span className="truncate">{birthdayInfo?.name ?? entry.title}</span>
                                          {birthdayInfo ? <span className="shrink-0 text-[10px] text-muted-foreground">{birthdayInfo.age}yr</span> : null}
                                        </span>
                                      ) : (
                                        entry.title
                                      )}
                                    </button>
                                  );
                                })}
                                {entries.length > 3 ? <div className="px-2 text-[11px] text-muted-foreground">+{entries.length - 3} more</div> : null}
                              </div>
                            </>
                          ) : null}
                        </div>
                      );
                    })}
                  </div></div></div>{/* end calendar scroll wrappers */}

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
                            <div className={cn('mt-1 h-10 w-1 rounded-full', isVirtualBirthdayEntry(entry) ? 'bg-[#C60C30]' : (memberColorById[entry.ownerMemberId] ?? 'bg-primary'))} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold">{(() => {
                                    if (!isVirtualBirthdayEntry(entry)) return entry.title;
                                    const bi = getBirthdayInfo(entry, birthdays);
                                    return bi ? `${bi.name}, ${bi.age}` : entry.title;
                                  })()}</div>
                                  <div className="mt-1 text-xs text-muted-foreground">{isVirtualBirthdayEntry(entry) ? (() => { const bi = getBirthdayInfo(entry, birthdays); return bi ? `🎂 Turns ${bi.age} years old` : 'Birthday'; })() : `${owner?.name ?? 'Unknown member'} · ${entry.type} · ${formatTimeRange(entry)}`}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{entry.status}</div>
                                  {isVirtualBirthdayEntry(entry) ? (
                                    <div className="rounded-full border border-border/60 px-2 py-1 text-[11px] text-muted-foreground">Birthday</div>
                                  ) : (
                                    <>
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
                                    </>
                                  )}
                                </div>
                              </div>
                              {entry.location ? <div className="mt-2 text-xs text-muted-foreground">{entry.location}</div> : null}
                              {entry.checklist.length > 0 ? (
                                <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                                  {entry.checklist.map((item) => (
                                    <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-accent/40">
                                      <input
                                        type="checkbox"
                                        checked={item.isCompleted}
                                        onClick={(event) => event.stopPropagation()}
                                        onChange={(event) => {
                                          event.stopPropagation();
                                          void handleToggleChecklistItem(entry, item.id);
                                        }}
                                        className="h-3.5 w-3.5 rounded"
                                      />
                                      <span className={cn('text-xs', item.isCompleted && 'line-through text-muted-foreground')}>{item.text}</span>
                                    </label>
                                  ))}
                                </div>
                              ) : null}
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
                    <div className="space-y-3 overflow-auto lg:overflow-visible">
                      {filteredUpcoming.map((entry) => {
                        const owner = dashboard.members.find((member) => member.id === entry.ownerMemberId);
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            onClick={() => {
                              if (!isVirtualBirthdayEntry(entry)) {
                                handleEditEntry(entry);
                              }
                            }}
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
            ) : (
            <div className="mx-auto flex max-w-[1600px] flex-col gap-6">
              {errorText ? (
                <div className="rounded-3xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">{errorText}</div>
              ) : null}
              {activeNav !== 'timeline' ? (
              <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                <div className="mb-6 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Family Members</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Add and edit family members synced with the backend.</p>
                  </div>
                  {editingMemberId ? (
                    <button type="button" onClick={() => { setEditingMemberId(null); setMemberDraft({ name: '', role: 'parent', email: '', avatar: '' }); }} className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60">
                      Cancel edit
                    </button>
                  ) : null}
                </div>
                <div className="mb-6 grid gap-3 rounded-2xl border border-border/60 bg-background/30 p-4 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</span>
                    <input value={memberDraft.name} onChange={(event) => setMemberDraft((current) => ({ ...current, name: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" placeholder="Member name" />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Email</span>
                    <input type="email" value={memberDraft.email} onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" placeholder="name@example.com" />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Role</span>
                    <select value={memberDraft.role} onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value as MemberRole }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                      <option value="parent">Parent</option>
                      <option value="child">Child</option>
                    </select>
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Avatar (emoji)</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={memberDraft.avatar} onChange={(event) => setMemberDraft((current) => ({ ...current, avatar: event.target.value }))} className="w-16 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-center text-sm outline-none focus:border-primary/60" placeholder="👤" maxLength={4} />
                      {['👩', '👨', '👧', '👦', '👵', '👴', '🧑', '👶'].map((emoji) => (
                        <button key={emoji} type="button" onClick={() => setMemberDraft((current) => ({ ...current, avatar: emoji }))} className={cn('rounded-lg border px-2 py-1 text-base transition', memberDraft.avatar === emoji ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60')}>{emoji}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-end sm:col-span-2">
                    <button type="button" onClick={() => void handleSaveMember()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20">
                      {editingMemberId ? 'Update member' : 'Add member'}
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {dashboard.members.map((member) => (
                    <div key={member.id} className="rounded-2xl border border-border/60 bg-card/55 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setActiveMemberId(member.id);
                            router.push(`/member/${encodeURIComponent(member.id)}`);
                          }}
                          className="flex min-w-0 items-center gap-3 rounded-xl text-left hover:bg-accent/40"
                          aria-label={`Open ${member.name}`}
                        >
                          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-full', member.avatar ? 'text-2xl' : ('text-primary-foreground ' + (memberColorById[member.id] ?? 'bg-primary')))}>
                            {member.avatar ? member.avatar : <Users className="h-5 w-5" />}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{member.name}</div>
                            <div className="text-xs capitalize text-muted-foreground">{member.role}</div>
                            {member.email ? <div className="truncate text-xs text-muted-foreground">{member.email}</div> : null}
                          </div>
                        </button>
                        <button type="button" onClick={() => startEditMember(member)} className="rounded-lg border border-border/50 p-2 hover:bg-accent/60" aria-label={`Edit ${member.name}`}>
                          <Edit2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                {settingsMessage ? <div className="mt-4 rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm">{settingsMessage}</div> : null}
              </section>
              ) : null}

              {activeNav === 'timeline' ? (
              <section className="panel-surface rounded-[30px] border border-border/60 p-5 shadow-2xl shadow-black/10">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-semibold tracking-tight">Daily Timeline</h2>
                    <p className="mt-1 text-sm text-muted-foreground">View today&apos;s generated timeline for each member and manage member tasks directly from this page.</p>
                  </div>
                </div>
                <div className="mb-4">
                  <TodayTimelineBoard
                    members={dashboard.members}
                    timelinesByMemberId={todayTimelinesByMemberId}
                    celebrationTaskId={celebrationTaskId}
                    onConfirmTask={handleConfirmTodayTimelineTask}
                    onDeleteTask={handleDeleteTodayTimelineTask}
                    onSelectTask={(_memberId, task) => handleOpenTimelineTask(task)}
                  />
                </div>
                <div className="space-y-3">
                  {dashboard.members.map((member) => {
                    const isExpanded = expandedTemplatesMemberId === member.id;
                    const timelineEnabled = timelineSettingsByMemberId[member.id]?.enabled ?? false;
                    const todayTimeline = todayTimelinesByMemberId[member.id];
                    const isLoadingTodayTimeline = loadingTodayTimelineMemberId === member.id;
                    const todayTasks = (todayTimeline?.timeline.tasks ?? []).filter((task) => task.status !== 'skipped');
                    const taskDraft = getTimelineTaskDraft(member.id);
                    return (
                      <div key={member.id} className="rounded-2xl border border-border/60 bg-card/55">
                        <button
                          type="button"
                          onClick={() => void handleExpandTemplates(member.id)}
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-accent/40 rounded-2xl"
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', member.avatar ? 'text-xl' : ('text-primary-foreground ' + (memberColorById[member.id] ?? 'bg-primary')))}>
                              {member.avatar ? member.avatar : <Users className="h-4 w-4" />}
                            </div>
                            <div>
                              <div className="text-sm font-semibold">{member.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {timelineEnabled
                                  ? `${todayTimeline ? todayTasks.length : '...'} tasks today`
                                  : 'Timeline disabled'}
                              </div>
                            </div>
                          </div>
                          <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', isExpanded && 'rotate-90')} />
                        </button>
                        {isExpanded && (
                          <div className="border-t border-border/60 px-4 pb-4 pt-3 space-y-3">
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Today&apos;s generated timeline</span>
                                <button
                                  type="button"
                                  onClick={() => void loadTodayTimelineForMember(member.id)}
                                  className="rounded-lg border border-border/60 px-3 py-1.5 text-xs hover:bg-accent/60"
                                >
                                  Refresh today
                                </button>
                              </div>
                              {!timelineEnabled ? (
                                <div className="rounded-xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                                  Timeline is disabled for this member.
                                </div>
                              ) : isLoadingTodayTimeline || !todayTimeline ? (
                                <div className="rounded-xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                                  Loading today&apos;s timeline...
                                </div>
                              ) : todayTasks.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-border/70 px-4 py-4 text-sm text-muted-foreground">
                                  No tasks generated for this member today.
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  {todayTasks.map((task) => {
                                    const linkedTaskEntry = task.source === 'entry_task'
                                      ? dashboard.entries.find((entry) => entry.id === task.linkedEntryId)
                                      : undefined;
                                    return (
                                    <div key={task.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                                      <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{task.position}</span>
                                      <div className="flex-1">
                                        <div className={cn(
                                          'text-sm',
                                          task.status === 'completed' && 'text-muted-foreground line-through',
                                        )}>
                                          {task.title}
                                        </div>
                                        {task.isMilestone || task.rewardText ? (
                                          <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                                            Success milestone{task.rewardText ? ` - ${task.rewardText}` : ''}
                                          </div>
                                        ) : null}
                                      </div>
                                      {task.dueAt ? (
                                        <span className="text-xs text-muted-foreground">
                                          {new Date(task.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                      ) : null}
                                      <span className={cn(
                                        'rounded-full px-2 py-1 text-[10px] font-medium uppercase tracking-[0.08em]',
                                        task.status === 'completed' && 'bg-emerald-500/20 text-emerald-700',
                                        task.status === 'waiting_confirmation' && 'bg-amber-500/20 text-amber-700',
                                        task.status === 'pending' && 'bg-blue-500/20 text-blue-700',
                                        task.status === 'skipped' && 'bg-muted text-muted-foreground',
                                      )}>
                                        {task.status.replace('_', ' ')}
                                      </span>
                                      {linkedTaskEntry ? (
                                        <button
                                          type="button"
                                          aria-label={`Edit ${task.title}`}
                                          onClick={() => handleStartEditTimelineTask(linkedTaskEntry)}
                                          className="rounded-lg border border-border/60 p-1.5 text-muted-foreground hover:bg-accent/60"
                                        >
                                          <Edit2 className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                      {task.status !== 'completed' && task.status !== 'skipped' ? (
                                        <button
                                          type="button"
                                          aria-label={`Delete ${task.title}`}
                                          onClick={() => void handleDeleteTodayTimelineTask(member.id, task.id)}
                                          className="rounded-lg border border-border/60 p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                    </div>
                                  )})}
                                </div>
                              )}
                            </div>
                            <div className="space-y-2 border-t border-border/40 pt-3">
                              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Add task</div>

                              {editingTimelineTaskId ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                                  <input
                                    value={editingTimelineTaskDraft.title}
                                    onChange={(event) => setEditingTimelineTaskDraft((current) => ({ ...current, title: event.target.value }))}
                                    className="min-w-[180px] flex-1 rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-sm outline-none focus:border-primary/60"
                                    placeholder="Task name"
                                  />
                                  <label className="inline-flex items-center gap-1 rounded-lg border border-border/60 px-2 py-1 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={editingTimelineTaskDraft.recurring}
                                      onChange={(event) => setEditingTimelineTaskDraft((current) => ({ ...current, recurring: event.target.checked }))}
                                    />
                                    Recurring
                                  </label>
                                  <input
                                    type="time"
                                    value={editingTimelineTaskDraft.time}
                                    onChange={(event) => setEditingTimelineTaskDraft((current) => ({ ...current, time: event.target.value }))}
                                    className="rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60"
                                  />
                                  <input
                                    type="number"
                                    min={0}
                                    value={editingTimelineTaskDraft.position}
                                    onChange={(event) => setEditingTimelineTaskDraft((current) => ({ ...current, position: event.target.value }))}
                                    className="w-20 rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60"
                                    placeholder="Pos"
                                  />
                                  <input
                                    value={editingTimelineTaskDraft.treat}
                                    onChange={(event) => setEditingTimelineTaskDraft((current) => ({ ...current, treat: event.target.value }))}
                                    className="min-w-[140px] flex-1 rounded-lg border border-border/60 bg-background/60 px-2 py-1 text-xs outline-none focus:border-primary/60"
                                    placeholder="Treat on complete"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const taskToEdit = todayTasks.find((task) => task.source === 'entry_task' && task.linkedEntryId === editingTimelineTaskId);
                                      if (taskToEdit) {
                                        void handleSaveTimelineTask(member.id, editingTimelineTaskId);
                                      }
                                    }}
                                    className="rounded-lg bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                                  >
                                    Save
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleCancelEditTimelineTask()}
                                    className="rounded-lg border border-border/40 px-2 py-1 text-xs hover:bg-accent/60"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : null}

                              <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_120px_90px_minmax(0,1fr)_auto] md:items-end">
                                <label className="grid gap-1">
                                  <span className="text-xs text-muted-foreground">Task name</span>
                                  <input
                                    value={taskDraft.title}
                                    onChange={(event) => setTimelineTaskDraft(member.id, { title: event.target.value })}
                                    placeholder="Task name"
                                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs text-muted-foreground">Time</span>
                                  <input
                                    type="time"
                                    step={60}
                                    value={taskDraft.time}
                                    onChange={(event) => setTimelineTaskDraft(member.id, { time: event.target.value })}
                                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                                  />
                                </label>
                                <label className="grid gap-1">
                                  <span className="text-xs text-muted-foreground">Pos</span>
                                  <input
                                    type="number"
                                    min={0}
                                    value={taskDraft.position}
                                    onChange={(event) => setTimelineTaskDraft(member.id, { position: event.target.value })}
                                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                                  />
                                </label>
                                <div className="grid gap-2">
                                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                      type="checkbox"
                                      checked={taskDraft.recurring}
                                      onChange={(event) => setTimelineTaskDraft(member.id, { recurring: event.target.checked })}
                                      className="h-4 w-4 rounded border-border/60"
                                    />
                                    Recurring daily
                                  </label>
                                  <input
                                    value={taskDraft.treat}
                                    onChange={(event) => setTimelineTaskDraft(member.id, { treat: event.target.value })}
                                    placeholder="Treat on complete"
                                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleAddTimelineTask(member.id)}
                                  className="rounded-xl bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20"
                                >
                                  Add task
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
              ) : null}
            </div>
            )}
          </section>
        </main>
      </div>

      {showConfetti ? (
        <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
          {Array.from({ length: 90 }).map((_, index) => {
            const left = (index * 11) % 100;
            const delay = (index % 12) * 0.05;
            const duration = 1.4 + ((index % 5) * 0.25);
            const color = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'][index % 5];
            return (
              <span
                key={`confetti-${index}`}
                className="timeline-confetti-piece"
                style={{
                  left: `${left}%`,
                  animationDelay: `${delay}s`,
                  animationDuration: `${duration}s`,
                  backgroundColor: color,
                }}
              />
            );
          })}
        </div>
      ) : null}

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
              <div className="grid gap-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recurrence</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <select
                    aria-label="Recurrence frequency"
                    value={draft.recurrenceFreq}
                    onChange={(event) => setDraft((current) => ({ ...current, recurrenceFreq: event.target.value as RecurrenceFreq }))}
                    className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="none">No repeat</option>
                    <option value="DAILY">Daily</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="YEARLY">Yearly</option>
                  </select>
                  {draft.recurrenceFreq !== 'none' ? (
                    <select
                      aria-label="Recurrence count"
                      value={draft.recurrenceCount}
                      onChange={(event) => setDraft((current) => ({ ...current, recurrenceCount: event.target.value }))}
                      className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="">Forever</option>
                      {[2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 26, 52].map((n) => (
                        <option key={n} value={String(n)}>×{n} times</option>
                      ))}
                    </select>
                  ) : null}
                </div>
              </div>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Invitees</span>
                <div className="space-y-2">
                  {draft.invitees.length > 0 ? (
                    <div className="space-y-1.5">
                      {draft.invitees.map((invitee, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={invitee.email}
                            disabled
                            className="rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-sm outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setDraft((current) => ({ ...current, invitees: current.invitees.filter((_, i) => i !== idx) }))}
                            className="rounded-lg border border-border/60 p-1 text-muted-foreground hover:bg-accent/60"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <select
                      className="flex-1 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                      onChange={(event) => {
                        if (event.target.value) {
                          const member = dashboard.members.find((m) => m.id === event.target.value);
                          if (member && member.email && !draft.invitees.some((inv) => inv.email === member.email)) {
                            setDraft((current) => ({
                              ...current,
                              invitees: [...current.invitees, { type: 'member' as const, id: member.id, email: member.email as string }],
                            }));
                          }
                          event.target.value = '';
                        }
                      }}
                    >
                      <option value="">Add member by email...</option>
                      {dashboard.members
                        .filter((m) => m.email && !draft.invitees.some((inv) => inv.id === m.id))
                        .map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.name} ({member.email})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              </label>
              <label className="grid gap-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</span>
                <div className="space-y-2">
                  {draft.tasks.length > 0 ? (
                    <div className="space-y-2">
                      {draft.tasks.map((task, idx) => (
                        <div key={idx} className="flex gap-2">
                          <input
                            type="text"
                            value={task.text}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                tasks: current.tasks.map((t, i) => (i === idx ? { ...t, text: event.target.value } : t)),
                              }))
                            }
                            placeholder="Task text"
                            className="flex-1 rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                          />
                          <select
                            value={task.assignedToMemberId || ''}
                            onChange={(event) =>
                              setDraft((current) => ({
                                ...current,
                                tasks: current.tasks.map((t, i) => (i === idx ? { ...t, assignedToMemberId: event.target.value || undefined } : t)),
                              }))
                            }
                            className="rounded-lg border border-border/60 bg-background/60 px-3 py-1.5 text-sm outline-none focus:border-primary/60"
                          >
                            <option value="">Assign to...</option>
                            <option value={draft.ownerMemberId}>{dashboard.members.find((m) => m.id === draft.ownerMemberId)?.name}</option>
                            {draft.invitees.map((inv) => {
                              if (inv.type === 'member' && inv.id) {
                                const member = dashboard.members.find((m) => m.id === inv.id);
                                return member ? (
                                  <option key={inv.id} value={inv.id}>
                                    {member.name}
                                  </option>
                                ) : null;
                              }
                              return null;
                            })}
                          </select>
                          <button
                            type="button"
                            onClick={() => setDraft((current) => ({ ...current, tasks: current.tasks.filter((_, i) => i !== idx) }))}
                            className="rounded-lg border border-border/60 p-1.5 text-muted-foreground hover:bg-accent/60"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((current) => ({ ...current, tasks: [...current.tasks, { text: '', assignedToMemberId: undefined }] }));
                    }}
                    className="rounded-lg border border-border/60 bg-background/40 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent/60"
                  >
                    + Add task
                  </button>
                </div>
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

      {birthdayDetailEntry ? (() => {
        const bi = getBirthdayInfo(birthdayDetailEntry, birthdays);
        const birthdayDate = new Date(birthdayDetailEntry.startTime).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-3xl border border-border/60 bg-card p-6 shadow-2xl">
              <div className="mb-5 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-2xl" style={{ backgroundImage: 'url(/birthday-pill.png)', backgroundSize: '200% 100%', backgroundPosition: 'center' }}>🎂</div>
                  <div>
                    <h2 className="text-xl font-bold">{bi?.name ?? birthdayDetailEntry.title}</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {bi ? `Turns ${bi.age} years old` : 'Birthday'} · {birthdayDate}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setBirthdayDetailEntry(null)}
                  className="rounded-lg border border-border/40 p-1.5 text-muted-foreground hover:bg-accent/60"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <label className="grid gap-2">
                <span className="text-sm font-medium">Wishes &amp; gift ideas</span>
                <textarea
                  value={birthdayWishesText}
                  onChange={(event) => setBirthdayWishesText(event.target.value)}
                  placeholder="Note down wishes, gift ideas or hints..."
                  className="min-h-[100px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                />
              </label>
              <div className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-background/40 px-4 py-3">
                <span className="text-sm text-muted-foreground">🔗 Ønskeskyen integration</span>
                <a
                  href="https://onskeskyen.dk/da"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto rounded-lg border border-border/60 px-3 py-1.5 text-xs text-primary hover:bg-accent/60"
                >
                  Open Ønskeskyen ↗
                </a>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setBirthdayDetailEntry(null)}
                  className="rounded-xl border border-border/60 px-4 py-2 text-sm hover:bg-accent/60"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveBirthdayWishes()}
                  className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 hover:brightness-110"
                >
                  Save wishes
                </button>
              </div>
            </div>
          </div>
        );
      })() : null}

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
              { id: 'calendars', label: 'Calendars' },
              { id: 'mail', label: 'Mail' },
              { id: 'sync', label: 'Sync' },
              { id: 'recurring', label: 'Recurring' },
              { id: 'birthdays', label: 'Birthdays' },
              { id: 'weather', label: 'Weather' },
              { id: 'developer', label: 'Developer' },
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
              <div className="space-y-4">
                <div className="grid gap-3 rounded-2xl border border-border/60 bg-background/30 p-4 sm:grid-cols-2">
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Name</span>
                    <input value={memberDraft.name} onChange={(event) => setMemberDraft((current) => ({ ...current, name: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" placeholder="Member name" />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Email</span>
                    <input type="email" value={memberDraft.email} onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60" placeholder="name@example.com" />
                  </label>
                  <label className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Role</span>
                    <select value={memberDraft.role} onChange={(event) => setMemberDraft((current) => ({ ...current, role: event.target.value as MemberRole }))} className="rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-sm outline-none focus:border-primary/60">
                      <option value="parent">Parent</option>
                      <option value="child">Child</option>
                    </select>
                  </label>
                  <div className="grid gap-1.5">
                    <span className="text-xs uppercase tracking-[0.14em] text-muted-foreground">Avatar (emoji)</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <input value={memberDraft.avatar} onChange={(event) => setMemberDraft((current) => ({ ...current, avatar: event.target.value }))} className="w-16 rounded-xl border border-border/60 bg-background/60 px-3 py-2 text-center text-sm outline-none focus:border-primary/60" placeholder="👤" maxLength={4} />
                      {['👩', '👨', '👧', '👦', '👵', '👴', '🧑', '👶'].map((emoji) => (
                        <button key={emoji} type="button" onClick={() => setMemberDraft((current) => ({ ...current, avatar: emoji }))} className={cn('rounded-lg border px-2 py-1 text-base transition', memberDraft.avatar === emoji ? 'border-primary bg-primary/10' : 'border-border/60 hover:bg-accent/60')}>{emoji}</button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:col-span-2">
                    <button type="button" onClick={() => void handleSaveMember()} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20">
                      {editingMemberId ? 'Update member' : 'Add member'}
                    </button>
                    {editingMemberId ? (
                      <button type="button" onClick={() => { setEditingMemberId(null); setMemberDraft({ name: '', role: 'parent', email: '', avatar: '' }); }} className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60">
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="space-y-2">
                  {dashboard.members.map((member) => (
                    <div key={member.id} className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', member.avatar ? 'text-xl' : ('text-primary-foreground ' + (memberColorById[member.id] ?? 'bg-primary')))}>
                            {member.avatar ? member.avatar : <Users className="h-4 w-4" />}
                          </div>
                          <div>
                            <div className="text-sm font-semibold">{member.name}</div>
                            <div className="text-xs text-muted-foreground capitalize">{member.role}{member.email ? ` · ${member.email}` : ''}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button type="button" onClick={() => startEditMember(member)} className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60">Edit</button>
                          {canManageMembers && member.id !== activeMember?.id ? (
                            <button
                              type="button"
                              onClick={() => setMemberDeleteTarget(member)}
                              disabled={deletingMemberId === member.id}
                              className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                            >
                              {deletingMemberId === member.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 border-t border-border/40 pt-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={timelineSettingsByMemberId[member.id]?.enabled ?? false}
                            onClick={() => void handleToggleMemberTimeline(member.id)}
                            className={cn('relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none', (timelineSettingsByMemberId[member.id]?.enabled ?? false) ? 'bg-primary' : 'bg-muted')}
                          >
                            <span className={cn('inline-block h-4 w-4 transform rounded-full bg-white shadow transition', (timelineSettingsByMemberId[member.id]?.enabled ?? false) ? 'translate-x-4' : 'translate-x-0')} />
                          </button>
                          <span className="text-xs text-muted-foreground">Daily timeline</span>
                        </div>
                        {(timelineSettingsByMemberId[member.id]?.enabled ?? false) && (
                          <label className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Max tasks/day</span>
                            <input
                              type="number"
                              min={1}
                              max={50}
                              defaultValue={timelineSettingsByMemberId[member.id]?.maxTasksPerDay ?? 10}
                              onBlur={(event) => {
                                const val = Math.min(50, Math.max(1, Number(event.target.value) || 10));
                                void updateMemberTimelineSettings(member.id, { maxTasksPerDay: val }).then((updated) => {
                                  setTimelineSettingsByMemberId((prev) => ({ ...prev, [member.id]: updated }));
                                });
                              }}
                              className="w-16 rounded-xl border border-border/60 bg-background/60 px-2 py-1 text-sm outline-none focus:border-primary/60"
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {settingsTab === 'calendars' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                  Calendars are created automatically for each member. You can delete unused ones here.
                </div>
                <div className="space-y-2">
                  {dashboard.calendars.map((calendar) => (
                    <div key={calendar.id} className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/60 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ background: calendar.color }} />
                        <div>
                          <div className="text-sm font-semibold">{calendar.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {calendar.ownerMemberId
                              ? (dashboard.members.find((m) => m.id === calendar.ownerMemberId)?.name ?? 'Unknown member')
                              : 'Shared'}
                          </div>
                        </div>
                      </div>
                      {canManageMembers && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteCalendar(calendar.id)}
                          disabled={deletingCalendarId === calendar.id}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-60"
                        >
                          {deletingCalendarId === calendar.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                  {dashboard.calendars.length === 0 && (
                    <div className="py-6 text-center text-sm text-muted-foreground">No calendars yet.</div>
                  )}
                </div>
              </div>
            ) : null}

            {settingsTab === 'mail' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                  Configure SMTP for sending reminders/invites and IMAP for inbox sync.
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 sm:col-span-2">
                    <span className="text-sm font-medium">SMTP host</span>
                    <input
                      value={settings.mail.smtpHost}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpHost: event.target.value } } : current)}
                      placeholder="smtp.example.com"
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">SMTP port</span>
                    <input
                      type="number"
                      min={1}
                      value={settings.mail.smtpPort}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpPort: Number(event.target.value) || 0 } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">SMTP from address</span>
                    <input
                      type="email"
                      value={settings.mail.smtpFrom}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpFrom: event.target.value } } : current)}
                      placeholder="mental-load@example.com"
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
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">SMTP password</span>
                    <input
                      type="password"
                      value={settings.mail.smtpPass}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, smtpPass: event.target.value } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 sm:col-span-2">
                    <span className="text-sm font-medium">IMAP host</span>
                    <input
                      value={settings.mail.imapHost}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapHost: event.target.value } } : current)}
                      placeholder="imap.example.com"
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">IMAP port</span>
                    <input
                      type="number"
                      min={1}
                      value={settings.mail.imapPort}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapPort: Number(event.target.value) || 0 } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">IMAP secure</span>
                    <select
                      value={settings.mail.imapSecure ? 'yes' : 'no'}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapSecure: event.target.value === 'yes' } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">IMAP user</span>
                    <input
                      value={settings.mail.imapUser}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapUser: event.target.value } } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">IMAP password</span>
                    <input
                      type="password"
                      value={settings.mail.imapPass}
                      onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, imapPass: event.target.value } } : current)}
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
                <label className="grid gap-2">
                  <span className="text-sm font-medium">Preview mode</span>
                  <select
                    value={settings.mail.previewMode ? 'yes' : 'no'}
                    onChange={(event) => setSettings((current) => current ? { ...current, mail: { ...current.mail, previewMode: event.target.value === 'yes' } } : current)}
                    className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                  >
                    <option value="yes">Yes (log only)</option>
                    <option value="no">No (send via SMTP)</option>
                  </select>
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
                <div className="grid gap-3 rounded-2xl border border-border/60 bg-background/30 p-4 sm:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Auto pull IMAP inbox</span>
                    <select
                      value={settings.sync.configJson.mailpitAutoPullEnabled === false ? 'no' : 'yes'}
                      onChange={(event) => setSettings((current) => current ? {
                        ...current,
                        sync: {
                          ...current.sync,
                          configJson: {
                            ...current.sync.configJson,
                            mailpitAutoPullEnabled: event.target.value === 'yes',
                          },
                        },
                      } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    >
                      <option value="no">No (recommended)</option>
                      <option value="yes">Yes</option>
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Auto pull interval (minutes)</span>
                    <input
                      type="number"
                      min={1}
                      value={Number(settings.sync.configJson.mailpitPullMinutes ?? 1)}
                      onChange={(event) => setSettings((current) => current ? {
                        ...current,
                        sync: {
                          ...current.sync,
                          configJson: {
                            ...current.sync.configJson,
                            mailpitPullMinutes: Math.max(1, Number(event.target.value) || 1),
                          },
                        },
                      } : current)}
                      className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                    />
                  </label>
                  <div className="sm:col-span-2 text-xs text-muted-foreground">
                    Auto pull runs only when Sync provider is set to invite-mail and this toggle is enabled.
                  </div>
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
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/60 bg-background/30 p-4">
                  <div className="mb-3 text-sm font-medium">Creation parameters</div>
                  <p className="mb-4 text-xs text-muted-foreground">These defaults are used when creating a new event.</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium">Enable default recurring</span>
                      <select
                        value={recurringDefaults.enabled ? 'yes' : 'no'}
                        onChange={(event) => void handleSaveRecurringDefaults({
                          enabled: event.target.value === 'yes',
                          freq: recurringDefaults.freq,
                          count: recurringDefaults.count,
                        })}
                        className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                      >
                        <option value="no">No</option>
                        <option value="yes">Yes</option>
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium">Default frequency</span>
                      <select
                        value={recurringDefaults.freq}
                        onChange={(event) => void handleSaveRecurringDefaults({
                          enabled: recurringDefaults.enabled,
                          freq: event.target.value as RecurrenceFreq,
                          count: recurringDefaults.count,
                        })}
                        className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                      >
                        <option value="none">No repeat</option>
                        <option value="DAILY">Daily</option>
                        <option value="WEEKLY">Weekly</option>
                        <option value="MONTHLY">Monthly</option>
                        <option value="YEARLY">Yearly</option>
                      </select>
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium">Default count</span>
                      <input
                        type="number"
                        min={1}
                        value={recurringDefaults.count}
                        onChange={(event) => void handleSaveRecurringDefaults({
                          enabled: recurringDefaults.enabled,
                          freq: recurringDefaults.freq,
                          count: event.target.value,
                        })}
                        className="rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
                        placeholder="Blank = forever"
                      />
                    </label>
                  </div>
                </div>

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
              </div>
            ) : null}

            {settingsTab === 'birthdays' ? (
              <div className="space-y-3">
                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                  Birthdays are standalone and will appear in the calendar even when no member is attached.
                </div>
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
                <div className="grid gap-3 sm:grid-cols-1">
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
                  <label className="grid gap-2">
                    <span className="text-sm font-medium">Wishes &amp; gift ideas</span>
                    <textarea
                      value={birthdaysDraft.wishes}
                      onChange={(event) => setBirthdaysDraft((current) => ({ ...current, wishes: event.target.value }))}
                      placeholder="Note down wishes or gift ideas..."
                      className="min-h-[80px] rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60"
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
                      onClick={() => setBirthdaysDraft({ name: '', date: '', memberId: '', notifyDaysBefore: 7, wishes: '' })}
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

            {settingsTab === 'developer' ? (
              <div className="space-y-4">
                {/* Version comparison card */}
                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 space-y-2">
                  <div className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Version Info</div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    <span className="text-muted-foreground">Frontend build</span>
                    <span className="tabular-nums font-mono">
                      v{process.env.NEXT_PUBLIC_APP_VERSION}
                      {process.env.NEXT_PUBLIC_APP_COMMIT !== 'local'
                        ? <span className="ml-1 text-muted-foreground/60">({process.env.NEXT_PUBLIC_APP_COMMIT?.slice(0, 7)})</span>
                        : <span className="ml-1 text-amber-500/80">(dev)</span>}
                    </span>
                    <span className="text-muted-foreground">Server running</span>
                    {serverVersion
                      ? <span className="tabular-nums font-mono">
                          v{serverVersion.version}
                          <span className="ml-1 text-muted-foreground/60">({serverVersion.commit?.slice(0, 7)})</span>
                          {serverVersion.version === process.env.NEXT_PUBLIC_APP_VERSION
                            ? <span className="ml-2 text-emerald-500 text-xs">✓ in sync</span>
                            : <span className="ml-2 text-amber-500 text-xs">⚠ mismatch</span>}
                        </span>
                      : <button type="button" onClick={() => void fetchServerVersion()} className="text-primary hover:underline text-left">Check server</button>}
                    <span className="text-muted-foreground">Latest on GitHub</span>
                    {remoteVersion === 'loading'
                      ? <span className="text-muted-foreground/60 text-xs">Checking…</span>
                      : remoteVersion === 'unavailable'
                        ? <button type="button" onClick={() => void fetchRemoteVersion()} className="text-primary hover:underline text-left text-xs">Check for updates</button>
                        : <span className="tabular-nums font-mono">
                            <span className="text-muted-foreground/60">({remoteVersion?.shortSha})</span>
                            {remoteVersion?.sha.startsWith(process.env.NEXT_PUBLIC_APP_COMMIT ?? '__never__')
                              || process.env.NEXT_PUBLIC_APP_COMMIT?.startsWith(remoteVersion?.shortSha ?? '')
                              ? <span className="ml-2 text-emerald-500 text-xs">✓ up to date</span>
                              : <span className="ml-2 text-amber-500 text-xs">⚠ update available</span>}
                            <span className="ml-2 text-muted-foreground/60 text-xs truncate max-w-[160px] inline-block align-bottom" title={remoteVersion?.message}>{remoteVersion?.message?.split('\n')[0]}</span>
                          </span>}
                  </div>
                  {serverVersion?.deployedAt ? (
                    <div className="text-xs text-muted-foreground/60">
                      Deployed {new Date(serverVersion.deployedAt).toLocaleString()}
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/30 px-4 py-3 text-sm text-muted-foreground">
                  Force a production update from the current GitHub repository.
                  {!process.env.NEXT_PUBLIC_APP_COMMIT || process.env.NEXT_PUBLIC_APP_COMMIT === 'local'
                    ? <span className="block mt-1 text-amber-500/80 text-xs">Running in dev mode — only git pull will run (no Docker rebuild).</span>
                    : null}
                </div>
                <button
                  type="button"
                  onClick={() => { setServerVersion(null); setRemoteVersion('unavailable'); void handleForceUpdate(); }}
                  disabled={updateInProgress}
                  className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 disabled:opacity-60"
                >
                  {updateInProgress && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  Update production
                </button>
                {updateMessage && (
                  <div className={cn('rounded-2xl border px-4 py-3 text-sm', updateMessage.startsWith('Error') || updateMessage.startsWith('Failed') ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border/60 bg-background/30')}>
                    {updateMessage}
                  </div>
                )}
              </div>
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

      {memberDeleteTarget ? (
        <OverlayPanel title="Delete member" onClose={() => { if (!deletingMemberId) setMemberDeleteTarget(null); }}>
          <div className="space-y-4">
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              This will permanently delete {memberDeleteTarget.name} and all related member data. This action cannot be undone.
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setMemberDeleteTarget(null)}
                disabled={Boolean(deletingMemberId)}
                className="rounded-xl border border-border/60 px-3 py-2 text-sm hover:bg-accent/60 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteMember()}
                disabled={Boolean(deletingMemberId)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-destructive/40 bg-destructive px-3 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-60"
              >
                {deletingMemberId ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete member
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

type BirthdaySetting = { id: string; name: string; date: string; memberId?: string; notifyDaysBefore: number; wishes?: string };

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
    const wishes = typeof source.wishes === 'string' ? source.wishes : undefined;

    parsed.push({
      id,
      name,
      date,
      memberId,
      notifyDaysBefore: Number.isFinite(notifyDaysBefore) ? notifyDaysBefore : 7,
      wishes,
    });
  });

  return parsed;
}

function parseRecurringDefaults(value: unknown): { enabled: boolean; freq: RecurrenceFreq; count: string } {
  if (!value || typeof value !== 'object') {
    return { enabled: false, freq: 'none', count: '' };
  }

  const source = value as Record<string, unknown>;
  const enabled = source.enabled === true;
  const freqCandidate = typeof source.freq === 'string' ? source.freq : 'none';
  const freq = (['none', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const).includes(freqCandidate as RecurrenceFreq)
    ? (freqCandidate as RecurrenceFreq)
    : 'none';
  const countRaw = Number(source.count);
  const count = Number.isFinite(countRaw) && countRaw > 0 ? String(Math.floor(countRaw)) : '';

  return {
    enabled,
    freq,
    count,
  };
}

function applyRecurringDefaultsToDraft(
  draft: EventDraft,
  defaults: { enabled: boolean; freq: RecurrenceFreq; count: string },
): EventDraft {
  if (!defaults.enabled || defaults.freq === 'none') {
    return {
      ...draft,
      recurrenceFreq: 'none',
      recurrenceCount: '',
    };
  }

  return {
    ...draft,
    recurrenceFreq: defaults.freq,
    recurrenceCount: defaults.count,
  };
}

function buildBirthdayOccurrencesInRange(
  birthdays: BirthdaySetting[],
  from: Date,
  to: Date,
  fallbackCalendarId?: string,
  fallbackOwnerMemberId?: string,
): Entry[] {
  const occurrences: Entry[] = [];
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  birthdays.forEach((birthday) => {
    const parts = birthday.date.split('-').map((part) => Number(part));
    if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
      return;
    }

    const [, month, day] = parts;
    for (let year = from.getFullYear(); year <= to.getFullYear(); year += 1) {
      const start = new Date(year, month - 1, day, 12, 0, 0, 0);
      if (Number.isNaN(start.getTime()) || start < from || start > to) {
        continue;
      }

      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const now = new Date().toISOString();
      const baseId = `birthday:${birthday.id}:${year}`;

      occurrences.push({
        id: baseId,
        title: `${birthday.name} birthday`,
        type: 'event',
        ownerMemberId: birthday.memberId ?? fallbackOwnerMemberId ?? 'birthday-unassigned',
        calendarId: fallbackCalendarId ?? 'birthday-calendar',
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone,
        allDay: true,
        reminders: birthday.notifyDaysBefore > 0 ? [{ id: `${baseId}:reminder`, minutesBefore: birthday.notifyDaysBefore * 24 * 60 }] : [],
        checklist: [],
        status: 'active',
        recurrenceRule: 'FREQ=YEARLY',
        invitees: [],
        linkedEntryIds: [],
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  return occurrences;
}

function isVirtualBirthdayEntry(entry: Entry): boolean {
  return entry.id.startsWith('birthday:');
}

function getBirthdayInfo(entry: Entry, allBirthdays: BirthdaySetting[]): { name: string; age: number; birthday: BirthdaySetting } | null {
  const match = entry.id.match(/^birthday:(.+):(\d{4})$/);
  if (!match) return null;
  const birthdayId = match[1];
  const occurrenceYear = parseInt(match[2], 10);
  const birthday = allBirthdays.find((b) => b.id === birthdayId);
  if (!birthday) return null;
  const birthYear = parseInt(birthday.date.split('-')[0], 10);
  if (!Number.isFinite(birthYear) || !Number.isFinite(occurrenceYear)) return null;
  return { name: birthday.name, age: occurrenceYear - birthYear, birthday };
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function countTasks(entries: Entry[]) {
  return entries.reduce((total, entry) => {
    const checklistCount = entry.checklist.length;
    const standaloneTaskCount = entry.type === 'task' && checklistCount === 0 ? 1 : 0;
    return total + checklistCount + standaloneTaskCount;
  }, 0);
}

function summarizeTasks(entries: Entry[], memberId?: string) {
  return entries.reduce(
    (accumulator, entry) => {
      if (entry.checklist.length > 0) {
        const relevantItems = memberId
          ? entry.checklist.filter((item) => (item.assignedToMemberId ?? entry.ownerMemberId) === memberId)
          : entry.checklist;
        accumulator.total += relevantItems.length;
        accumulator.done += relevantItems.filter((item) => item.isCompleted).length;
        return accumulator;
      }

      if (entry.type === 'task' && (!memberId || (entry.assignedToMemberId ?? entry.ownerMemberId) === memberId)) {
        accumulator.total += 1;
        if (entry.status === 'completed') {
          accumulator.done += 1;
        }
      }

      return accumulator;
    },
    { done: 0, total: 0 },
  );
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
    recurrenceFreq: 'none',
    recurrenceCount: '',
    tasks: [],
    invitees: [],
    reminder1Mode: 'none',
    reminder1CustomHours: '',
    reminder2Mode: 'none',
    reminder2CustomHours: '',
  };
}

function buildDefaultTimeRange(date = new Date()) {
  const now = new Date();
  const start = new Date(date);
  start.setHours(now.getHours(), now.getMinutes(), 0, 0);

  const end = new Date(start);
  end.setHours(start.getHours() + 1, start.getMinutes(), 0, 0);
  return { start, end };
}

function buildRecurrenceRule(freq: RecurrenceFreq, count: string): string | undefined {
  if (freq === 'none') {
    return undefined;
  }

  const countNum = Number(count);
  const countPart = Number.isFinite(countNum) && countNum > 0 ? `;COUNT=${countNum}` : '';
  return `FREQ=${freq}${countPart}`;
}

function parseRecurrenceRule(rule?: string): { freq: RecurrenceFreq; count: string } {
  if (!rule) {
    return { freq: 'none', count: '' };
  }

  const freqMatch = rule.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
  const countMatch = rule.match(/COUNT=(\d+)/);
  return {
    freq: (freqMatch?.[1] as RecurrenceFreq | undefined) ?? 'none',
    count: countMatch?.[1] ?? '',
  };
}

function normalizeTemplateExpectedTime(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const match = trimmed.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) {
    return undefined;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatTemplateExpectedTime(value: string): string {
  const normalized = normalizeTemplateExpectedTime(value);
  return normalized ?? value;
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

function getEntriesForDate(entries: Entry[], members: Member[], date: Date, searchQuery: string, memberFilterId: string) {
  return entries.filter((entry) =>
    sameDay(new Date(entry.startTime), date)
    && matchesMemberFilter(entry, memberFilterId)
    && matchesSearch(entry, members, searchQuery),
  );
}

function matchesMemberFilter(entry: Entry, memberFilterId: string) {
  if (!memberFilterId) {
    return true;
  }

  return entry.ownerMemberId === memberFilterId;
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
