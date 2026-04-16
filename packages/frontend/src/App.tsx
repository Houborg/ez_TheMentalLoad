import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { AppSettings, AssistantDraft, AssistantParseResponse, Calendar, DashboardSnapshot, Entry, Member } from '@mental-load/contracts';

const initialStart = nextRoundedHour();
const initialEnd = new Date(initialStart.getTime() + 60 * 60 * 1000);
const sampleIcs = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'SUMMARY:Imported school event', 'DTSTART:20260428T080000Z', 'DTEND:20260428T090000Z', 'RRULE:FREQ=WEEKLY;COUNT=2', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

type AppView = 'planner' | 'settings';
type SettingsTab = 'members' | 'sync' | 'theme' | 'birthdays' | 'ai' | 'general';

export default function App() {
  const [members, setMembers] = useState<Member[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [status, setStatus] = useState('Loading planner…');
  const [currentView, setCurrentView] = useState<AppView>('planner');
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('members');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [selectedCalendarId, setSelectedCalendarId] = useState('');
  const [title, setTitle] = useState('School pickup');
  const [entryType, setEntryType] = useState<Entry['type']>('event');
  const [recurrenceRule, setRecurrenceRule] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [startTime, setStartTime] = useState(toDateTimeLocal(initialStart));
  const [endTime, setEndTime] = useState(toDateTimeLocal(initialEnd));
  const [reminderJobs, setReminderJobs] = useState(0);
  const [icsText, setIcsText] = useState(sampleIcs);
  const [assistantMessage, setAssistantMessage] = useState('make an event tomorrow at 10:00 in Saga calendar: Birthday at ELLA');
  const [assistantDraft, setAssistantDraft] = useState<AssistantDraft | null>(null);
  const [assistantResponse, setAssistantResponse] = useState('');
  const [newMemberName, setNewMemberName] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<Member['role']>('child');
  const [birthdayName, setBirthdayName] = useState('');
  const [birthdayDate, setBirthdayDate] = useState('2026-05-01');
  const [funPrompt, setFunPrompt] = useState('Write a cheerful one-liner');
  const [funReply, setFunReply] = useState('Ask the AI playground anything fun about family planning.');

  useEffect(() => {
    void Promise.all([loadDashboard(), loadSettings()]);

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
    const mode = settings?.theme.mode ?? 'system';
    document.documentElement.dataset.theme = mode;
  }, [settings?.theme.mode]);

  const activeMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId),
    [members, selectedMemberId],
  );

  const birthdayEntries = useMemo(
    () => entries.filter((entry) => /birthday|fødselsdag/i.test(entry.title)).sort((left, right) => left.startTime.localeCompare(right.startTime)),
    [entries],
  );

  function updateLocalSettings(updater: (current: AppSettings) => AppSettings): void {
    setSettings((current) => (current ? updater(current) : current));
  }

  async function loadDashboard(): Promise<void> {
    try {
      const now = new Date();
      const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const query = new URLSearchParams({ from: now.toISOString(), to: inThirtyDays.toISOString() });

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

  async function loadSettings(): Promise<void> {
    try {
      const response = await fetch(apiUrl('/api/v1/settings'));
      if (!response.ok) {
        throw new Error('Settings request failed');
      }

      const data = (await response.json()) as AppSettings;
      setSettings(data);
    } catch {
      setStatus('Settings unavailable, using defaults');
      window.setTimeout(() => {
        void loadSettings();
      }, 1000);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!selectedMemberId || !selectedCalendarId) {
      setStatus('Select a member and calendar first');
      return;
    }

    try {
      const response = await fetch(apiUrl('/api/v1/entries'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          type: entryType,
          ownerMemberId: selectedMemberId,
          calendarId: selectedCalendarId,
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          allDay,
          recurrenceRule: recurrenceRule || undefined,
          reminders: [{ minutesBefore: 30 }],
        }),
      });

      if (!response.ok) {
        setStatus('Could not create event');
        return;
      }

      setStatus('Event created');
      setTitle('');
      setRecurrenceRule('');
      await loadDashboard();
    } catch {
      setStatus('Could not create event');
    }
  }

  async function markCompleted(entry: Entry): Promise<void> {
    const response = await fetch(apiUrl(`/api/v1/entries/${entry.id.split(':')[0]}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed' }),
    });

    setStatus(response.ok ? 'Entry completed' : 'Could not update entry');
    await loadDashboard();
  }

  async function importIcs(): Promise<void> {
    const response = await fetch(apiUrl('/api/v1/entries/import/ics'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        calendarId: selectedCalendarId,
        ownerMemberId: selectedMemberId,
        ics: icsText,
      }),
    });

    if (!response.ok) {
      setStatus('ICS import failed');
      return;
    }

    const result = (await response.json()) as { importedCount: number };
    setStatus(`Imported ${result.importedCount} item(s)`);
    await loadDashboard();
  }

  async function parseAssistant(): Promise<void> {
    const response = await fetch(apiUrl('/api/v1/assistant/parse'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: assistantMessage,
        memberId: selectedMemberId,
        calendarId: selectedCalendarId,
        language: settings?.assistant.language ?? 'en',
        existingDraft: assistantDraft ?? undefined,
      }),
    });

    if (!response.ok) {
      setAssistantResponse('Assistant parsing failed');
      return;
    }

    const result = (await response.json()) as AssistantParseResponse;
    setAssistantDraft(result.draft);
    setAssistantResponse(result.response);
    setStatus(result.missingFields.length === 0 ? 'Assistant draft ready' : 'Assistant follow-up needed');
  }

  async function confirmAssistant(): Promise<void> {
    if (!assistantDraft) {
      return;
    }

    const response = await fetch(apiUrl('/api/v1/assistant/confirm'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ draft: assistantDraft }),
    });

    if (!response.ok) {
      setStatus('Assistant confirm failed');
      return;
    }

    setStatus('Assistant entry created');
    setAssistantDraft(null);
    setAssistantMessage('');
    await loadDashboard();
  }

  async function askFunAssistant(): Promise<void> {
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

    setSettings((await response.json()) as AppSettings);
    setStatus('Settings saved');
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
      }),
    });

    if (!response.ok) {
      setStatus('Could not add member');
      return;
    }

    setNewMemberName('');
    setStatus('Member added');
    await loadDashboard();
  }

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
        title: `${birthdayName.trim()} birthday`,
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

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <p className="eyebrow">MentalLoad</p>
          <h1>Family weekly planner</h1>
          <p className="subtle">Shared planning, ownership, reminders, recurring events, assistant follow-ups, and provider sync.</p>
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
        <main className="grid">
          <section className="panel stack-panel">
            <div>
              <h2>Quick create</h2>
              <form className="form" onSubmit={handleSubmit}>
                <label>
                  Title
                  <input value={title} onChange={(event) => setTitle(event.target.value)} required />
                </label>
                <div className="two-col">
                  <label>
                    Type
                    <select value={entryType} onChange={(event) => setEntryType(event.target.value as Entry['type'])}>
                      <option value="event">Event</option>
                      <option value="task">Task</option>
                    </select>
                  </label>
                  <label>
                    Repeat
                    <select value={recurrenceRule} onChange={(event) => setRecurrenceRule(event.target.value)}>
                      <option value="">Does not repeat</option>
                      <option value="FREQ=DAILY;COUNT=5">Daily x5</option>
                      <option value="FREQ=WEEKLY;COUNT=6">Weekly x6</option>
                      <option value="FREQ=MONTHLY;COUNT=3">Monthly x3</option>
                    </select>
                  </label>
                </div>
                <label>
                  Member
                  <select value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name} ({member.role})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Calendar
                  <select value={selectedCalendarId} onChange={(event) => setSelectedCalendarId(event.target.value)}>
                    {calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="two-col">
                  <label>
                    Start
                    <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} />
                  </label>
                  <label>
                    End
                    <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} />
                  </label>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} />
                  All day
                </label>
                <div className="button-row">
                  <button type="submit" disabled={!selectedMemberId || !selectedCalendarId}>Create event</button>
                  <a className="secondary-button" href={apiUrl(`/api/v1/calendars/${selectedCalendarId}/export.ics`)} target="_blank" rel="noreferrer">
                    Export ICS
                  </a>
                </div>
              </form>
            </div>

            <div className="assistant-preview">
              <h3>Assistant draft flow</h3>
              <textarea
                aria-label="Assistant message"
                value={assistantMessage}
                onChange={(event) => setAssistantMessage(event.target.value)}
                rows={4}
              />
              <div className="button-row">
                <button type="button" className="secondary-action" onClick={() => void parseAssistant()}>
                  Parse with assistant
                </button>
                {assistantDraft ? (
                  <button type="button" className="secondary-action" onClick={() => void confirmAssistant()}>
                    Confirm assistant draft
                  </button>
                ) : null}
              </div>
              <p>{assistantResponse || 'Use natural language and the backend will create a deterministic draft.'}</p>
              {assistantDraft ? (
                <div className="draft-card">
                  <strong>{assistantDraft.title}</strong>
                  <span>{assistantDraft.type}</span>
                  <small>{assistantDraft.startTime ? formatDisplay(assistantDraft.startTime) : 'Date needed'}</small>
                </div>
              ) : null}
            </div>

            <div className="assistant-preview">
              <h3>ICS import</h3>
              <textarea aria-label="ICS import text" value={icsText} onChange={(event) => setIcsText(event.target.value)} rows={8} />
              <button type="button" className="secondary-action" onClick={() => void importIcs()}>
                Import ICS into selected calendar
              </button>
            </div>
          </section>

          <section className="panel wide">
            <div className="panel-header">
              <h2>This month ahead</h2>
              <span>{activeMember ? `Active member: ${activeMember.name}` : 'Choose a member'}</span>
            </div>

            <div className="member-columns">
              {members.map((member) => {
                const memberEntries = entries.filter((entry) => entry.ownerMemberId === member.id);
                return (
                  <div key={member.id} className="member-column">
                    <h3>{member.name}</h3>
                    {memberEntries.map((entry) => (
                      <article key={entry.id} className="entry-card">
                        <div className="entry-topline">
                          <strong>{entry.title}</strong>
                          <span className="pill">{entry.type}</span>
                        </div>
                        <small>{formatDisplay(entry.startTime)} → {formatDisplay(entry.endTime)}</small>
                        <div className="entry-flags">
                          {entry.recurrenceRule ? <span className="pill muted">Repeats</span> : null}
                          {entry.status === 'completed' ? <span className="pill success">Done</span> : null}
                          {entry.parentEntryId ? <span className="pill muted">Linked task</span> : null}
                        </div>
                        {entry.status !== 'completed' ? (
                          <button type="button" className="secondary-action" onClick={() => void markCompleted(entry)}>
                            Mark complete
                          </button>
                        ) : null}
                      </article>
                    ))}
                    {memberEntries.length === 0 ? <p className="empty">No entries yet</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        </main>
      ) : (
        <main className="settings-layout">
          <section className="panel settings-shell">
            <div className="panel-header">
              <div>
                <h2>Settings hub</h2>
                <p className="subtle">Manage members, sync, themes, Ollama, birthdays, and other family parameters in organized tabs.</p>
              </div>
            </div>

            <div className="settings-grid">
              <div className="tab-list" role="tablist" aria-label="Settings sections">
                {['members', 'sync', 'theme', 'birthdays', 'ai', 'general'].map((tab) => {
                  const labelMap: Record<string, string> = {
                    members: 'Members',
                    sync: 'Sync & mail',
                    theme: 'Theme',
                    birthdays: 'Birthdays',
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
                    <h3>Manage members</h3>
                    <div className="member-list">
                      {members.map((member) => (
                        <div key={member.id} className="summary-card">
                          <strong>{member.name}</strong>
                          <span className="pill muted">{member.role}</span>
                        </div>
                      ))}
                    </div>

                    <form className="form inline-form" onSubmit={(event) => void addMember(event)}>
                      <div className="two-col">
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
                      </div>
                      <button type="submit">Add member</button>
                    </form>
                  </section>
                ) : null}

                {activeSettingsTab === 'sync' && settings ? (
                  <section className="settings-section">
                    <h3>Manage sync settings</h3>
                    <div className="two-col">
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
                      <label>
                        Mail test recipient
                        <input
                          value={settings.mail.testRecipient}
                          onChange={(event) => updateLocalSettings((current) => ({
                            ...current,
                            mail: {
                              ...current.mail,
                              testRecipient: event.target.value,
                            },
                          }))}
                        />
                      </label>
                    </div>

                    <label>
                      Sync source
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
                      {settings.sync.lastSyncAt ? ` • Last sync ${formatShortDate(settings.sync.lastSyncAt)}` : ''}
                    </small>
                  </section>
                ) : null}

                {activeSettingsTab === 'theme' && settings ? (
                  <section className="settings-section">
                    <h3>Manage themes</h3>
                    <label>
                      Theme mode
                      <select
                        aria-label="Theme mode"
                        value={settings.theme.mode}
                        onChange={(event) => updateLocalSettings((current) => ({
                          ...current,
                          theme: { mode: event.target.value as AppSettings['theme']['mode'] },
                        }))}
                      >
                        <option value="system">System</option>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                      </select>
                    </label>
                    <p className="subtle">Switch the app between light, dark, or system theme and save when you are ready.</p>
                    <button type="button" onClick={() => void saveSettings()}>Save settings</button>
                  </section>
                ) : null}

                {activeSettingsTab === 'birthdays' ? (
                  <section className="settings-section">
                    <h3>Manage birthdays</h3>
                    <p className="subtle">Create recurring birthday entries that appear automatically in the calendar and trigger the gift reminder rule.</p>
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
                          <strong>{entry.title}</strong>
                          <small>{formatDisplay(entry.startTime)}</small>
                        </div>
                      )) : <p className="empty">No birthdays saved yet</p>}
                    </div>
                  </section>
                ) : null}

                {activeSettingsTab === 'ai' && settings ? (
                  <section className="settings-section">
                    <h3>Manage Ollama and AI chat</h3>
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
                    <h3>Other relevant parameters</h3>
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
    </div>
  );
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
