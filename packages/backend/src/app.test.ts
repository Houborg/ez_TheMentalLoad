import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildApp } from './app';

async function createTestApp() {
  process.env.SETTINGS_FILE = path.join(os.tmpdir(), `mental-load-settings-${Date.now()}-${Math.random()}.json`);
  return buildApp();
}

const DEMO_MEMBER_IDS = {
  mom: '11111111-1111-4111-8111-111111111111',
  dad: '22222222-2222-4222-8222-222222222222',
  saga: '33333333-3333-4333-8333-333333333333',
} as const;

const DEMO_CALENDAR_IDS = {
  family: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  saga: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
} as const;

test('health endpoint responds with ok', async () => {
  const app = await createTestApp();
  const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, 'ok');

  await app.close();
});

test('deploy update proxies to webhook when configured', async () => {
  const previousWebhookUrl = process.env.UPDATE_WEBHOOK_URL;
  const previousWebhookSecret = process.env.UPDATE_WEBHOOK_SECRET;
  const originalFetch = global.fetch;

  process.env.UPDATE_WEBHOOK_URL = 'http://127.0.0.1:9191';
  process.env.UPDATE_WEBHOOK_SECRET = 'test-secret';

  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'http://127.0.0.1:9191/update');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    return new Response(JSON.stringify({ ok: true, message: 'Deploy triggered for test.' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof global.fetch;

  try {
    const app = await createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/deploy/update' });

    assert.equal(response.statusCode, 200);
    assert.equal(response.json().ok, true);
    assert.equal(response.json().message, 'Deploy triggered for test.');

    await app.close();
  } finally {
    global.fetch = originalFetch;
    process.env.UPDATE_WEBHOOK_URL = previousWebhookUrl;
    process.env.UPDATE_WEBHOOK_SECRET = previousWebhookSecret;
  }
});

test('deploy update returns 502 when webhook responds with error', async () => {
  const previousWebhookUrl = process.env.UPDATE_WEBHOOK_URL;
  const previousWebhookSecret = process.env.UPDATE_WEBHOOK_SECRET;
  const originalFetch = global.fetch;

  process.env.UPDATE_WEBHOOK_URL = 'http://127.0.0.1:9191';
  process.env.UPDATE_WEBHOOK_SECRET = 'test-secret';

  global.fetch = (async () => {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof global.fetch;

  try {
    const app = await createTestApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/deploy/update' });

    assert.equal(response.statusCode, 502);
    assert.equal(response.json().ok, false);
    assert.match(response.json().message, /unauthorized/i);

    await app.close();
  } finally {
    global.fetch = originalFetch;
    process.env.UPDATE_WEBHOOK_URL = previousWebhookUrl;
    process.env.UPDATE_WEBHOOK_SECRET = previousWebhookSecret;
  }
});

test('creating a birthday event also creates the gift task', async () => {
  const app = await createTestApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Saga birthday',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.saga,
      startTime: '2026-04-20T10:00:00.000Z',
      endTime: '2026-04-20T11:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      reminders: [],
    },
  });

  assert.equal(createResponse.statusCode, 201);
  const created = createResponse.json();

  const entriesResponse = await app.inject({ method: 'GET', url: '/api/v1/entries' });
  const entries = entriesResponse.json();

  assert.equal(entries.length, 2);
  assert.ok(entries.some((entry: { title: string; parentEntryId?: string }) => entry.title === 'Buy a gift' && entry.parentEntryId === created.id));

  await app.close();
});

test('entry can be updated and deleted', async () => {
  const app = await createTestApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Doctor visit',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.mom,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: '2026-04-21T09:00:00.000Z',
      endTime: '2026-04-21T10:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      reminders: [{ minutesBefore: 30 }],
    },
  });

  const created = createResponse.json();

  const updateResponse = await app.inject({
    method: 'PATCH',
    url: `/api/v1/entries/${created.id}`,
    payload: { status: 'completed' },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json().status, 'completed');

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: `/api/v1/entries/${created.id}`,
  });

  assert.equal(deleteResponse.statusCode, 204);

  const entriesResponse = await app.inject({ method: 'GET', url: '/api/v1/entries' });
  const entries = entriesResponse.json();
  assert.equal(entries.length, 0);

  await app.close();
});

test('entry create and update persist checklist tasks and multiple reminders', async () => {
  const app = await createTestApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Family trip',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.mom,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: '2026-04-25T09:00:00.000Z',
      endTime: '2026-04-25T10:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      reminders: [{ minutesBefore: 5 }, { minutesBefore: 2880 }],
      checklist: [{ text: 'Pack snacks' }, { text: 'Charge camera' }],
    },
  });

  assert.equal(createResponse.statusCode, 201);
  assert.equal(createResponse.json().reminders.length, 2);
  assert.equal(createResponse.json().checklist.length, 2);

  const created = createResponse.json() as { id: string };
  const updateResponse = await app.inject({
    method: 'PATCH',
    url: `/api/v1/entries/${created.id}`,
    payload: {
      reminders: [{ minutesBefore: 10 }, { minutesBefore: 60 }],
      checklist: [{ text: 'Pack swimsuits' }],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.deepEqual(
    updateResponse.json().reminders.map((item: { minutesBefore: number }) => item.minutesBefore).sort((left: number, right: number) => left - right),
    [10, 60],
  );
  assert.deepEqual(
    updateResponse.json().checklist.map((item: { text: string }) => item.text),
    ['Pack swimsuits'],
  );

  await app.close();
});

test('entry create and update persist checklist task assignees', async () => {
  const app = await createTestApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Birthday prep',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.dad,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: '2026-04-25T09:00:00.000Z',
      endTime: '2026-04-25T10:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      reminders: [],
      checklist: [
        { text: 'Buy flowers', assignedToMemberId: DEMO_MEMBER_IDS.mom },
        { text: 'Buy cake', assignedToMemberId: DEMO_MEMBER_IDS.dad },
      ],
    },
  });

  assert.equal(createResponse.statusCode, 201);
  assert.deepEqual(
    createResponse.json().checklist.map((item: { text: string; assignedToMemberId?: string }) => ({
      text: item.text,
      assignedToMemberId: item.assignedToMemberId,
    })),
    [
      { text: 'Buy flowers', assignedToMemberId: DEMO_MEMBER_IDS.mom },
      { text: 'Buy cake', assignedToMemberId: DEMO_MEMBER_IDS.dad },
    ],
  );

  const created = createResponse.json() as { id: string };
  const updateResponse = await app.inject({
    method: 'PATCH',
    url: `/api/v1/entries/${created.id}`,
    payload: {
      checklist: [
        { text: 'Buy flowers', isCompleted: true, assignedToMemberId: DEMO_MEMBER_IDS.mom },
      ],
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.deepEqual(
    updateResponse.json().checklist.map((item: { text: string; isCompleted: boolean; assignedToMemberId?: string }) => ({
      text: item.text,
      isCompleted: item.isCompleted,
      assignedToMemberId: item.assignedToMemberId,
    })),
    [
      { text: 'Buy flowers', isCompleted: true, assignedToMemberId: DEMO_MEMBER_IDS.mom },
    ],
  );

  await app.close();
});

test('recurring entries expand into occurrences inside a requested date range', async () => {
  const app = await createTestApp();

  const createResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Weekly swim class',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.saga,
      startTime: '2026-04-20T15:00:00.000Z',
      endTime: '2026-04-20T16:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      recurrenceRule: 'FREQ=WEEKLY;COUNT=3',
      reminders: [{ minutesBefore: 60 }],
    },
  });

  assert.equal(createResponse.statusCode, 201);

  const occurrencesResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/entries/occurrences?from=2026-04-19T00:00:00.000Z&to=2026-05-10T23:59:59.000Z',
  });

  assert.equal(occurrencesResponse.statusCode, 200);
  const occurrences = occurrencesResponse.json() as Array<{ title: string; startTime: string }>;

  assert.equal(occurrences.filter((entry) => entry.title === 'Weekly swim class').length, 3);
  await app.close();
});

test('calendar entries export to ICS and can be imported back', async () => {
  const app = await createTestApp();

  await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Parent meeting',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.mom,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: '2026-04-23T17:00:00.000Z',
      endTime: '2026-04-23T18:00:00.000Z',
      timezone: 'Europe/Copenhagen',
      allDay: false,
      recurrenceRule: 'FREQ=WEEKLY;COUNT=2',
      reminders: [{ minutesBefore: 45 }],
    },
  });

  const exportResponse = await app.inject({ method: 'GET', url: `/api/v1/calendars/${DEMO_CALENDAR_IDS.family}/export.ics` });
  assert.equal(exportResponse.statusCode, 200);
  assert.match(exportResponse.body, /BEGIN:VCALENDAR/);
  assert.match(exportResponse.body, /SUMMARY:Parent meeting/);
  assert.match(exportResponse.body, /RRULE:FREQ=WEEKLY;COUNT=2/);

  const importResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries/import/ics',
    payload: {
      calendarId: DEMO_CALENDAR_IDS.family,
      ownerMemberId: DEMO_MEMBER_IDS.mom,
      ics: exportResponse.body,
    },
  });

  assert.equal(importResponse.statusCode, 200);
  const imported = importResponse.json() as { importedCount: number };
  assert.ok(imported.importedCount >= 1);

  await app.close();
});

test('assistant parses a natural language draft and confirms it deterministically', async () => {
  const app = await createTestApp();

  const parseResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/parse',
    payload: {
      message: 'make an event tomorrow at 10:00 in Saga calendar: Birthday at ELLA',
      memberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.saga,
      language: 'en',
    },
  });

  assert.equal(parseResponse.statusCode, 200);
  const parsed = parseResponse.json() as { draft: { title: string; startTime?: string }; requiresConfirmation: boolean };
  assert.equal(parsed.requiresConfirmation, true);
  assert.equal(parsed.draft.title, 'Birthday at ELLA');
  assert.ok(parsed.draft.startTime);

  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/confirm',
    payload: { draft: parseResponse.json().draft },
  });

  assert.equal(confirmResponse.statusCode, 201);
  assert.equal(confirmResponse.json().title, 'Birthday at ELLA');

  await app.close();
});

test('assistant supports follow-up messages to complete a partial draft', async () => {
  const app = await createTestApp();

  const firstPass = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/parse',
    payload: {
      message: 'add task: Pack school bag',
      memberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.saga,
      language: 'en',
    },
  });

  assert.equal(firstPass.statusCode, 200);
  assert.deepEqual(firstPass.json().missingFields, ['date/time']);

  const followUp = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/parse',
    payload: {
      message: 'tomorrow at 18:30',
      memberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.saga,
      language: 'en',
      existingDraft: firstPass.json().draft,
    },
  });

  assert.equal(followUp.statusCode, 200);
  assert.equal(followUp.json().draft.title, 'Pack school bag');
  assert.equal(followUp.json().missingFields.length, 0);

  const confirmResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/confirm',
    payload: { draft: followUp.json().draft },
  });

  assert.equal(confirmResponse.statusCode, 201);
  assert.equal(confirmResponse.json().title, 'Pack school bag');

  await app.close();
});

test('assistant fun chat returns a friendly response', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/fun',
    payload: {
      message: 'Tell me something fun about family planning',
      language: 'en',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(typeof response.json().response, 'string');
  assert.ok(response.json().response.length > 0);

  await app.close();
});

test('assistant status falls back to env Ollama URL when persisted settings contain loopback', async () => {
  process.env.OLLAMA_URL = 'http://ollama:11434';
  process.env.OLLAMA_MODEL = 'llama3.2:3b';

  const app = await createTestApp();

  await app.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    payload: {
      assistant: {
        ollamaUrl: 'http://127.0.0.1:11434',
      },
    },
  });

  const settingsResponse = await app.inject({ method: 'GET', url: '/api/v1/settings' });
  assert.equal(settingsResponse.statusCode, 200);
  assert.equal(settingsResponse.json().assistant.ollamaUrl, 'http://ollama:11434');

  const statusResponse = await app.inject({ method: 'GET', url: '/api/v1/assistant/status' });
  assert.equal(statusResponse.statusCode, 200);
  assert.equal(statusResponse.json().ollamaUrl, 'http://ollama:11434');
  assert.equal(statusResponse.json().modelName, 'llama3.2:3b');

  delete process.env.OLLAMA_URL;
  delete process.env.OLLAMA_MODEL;
  await app.close();
});

test('settings, member management, email preview, and manual sync endpoints work together', async () => {
  const app = await createTestApp();

  const settingsResponse = await app.inject({ method: 'GET', url: '/api/v1/settings' });
  assert.equal(settingsResponse.statusCode, 200);
  assert.equal(settingsResponse.json().theme.mode, 'light');

  const connectResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/connect',
    payload: {
      provider: 'google',
      configJson: {
        calendarId: 'family-primary',
        feedUrl: 'https://calendar.example.test/family.ics',
      },
    },
  });

  assert.equal(connectResponse.statusCode, 200);
  assert.equal(connectResponse.json().isConnected, true);

  const updateResponse = await app.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    payload: {
      theme: { mode: 'dark' },
      sync: {
        provider: 'google',
        isConnected: true,
        configJson: {
          calendarId: 'family-primary',
          feedUrl: 'https://calendar.example.test/family.ics',
        },
      },
      mail: {
        testRecipient: 'qa@local.test',
      },
    },
  });

  assert.equal(updateResponse.statusCode, 200);
  assert.equal(updateResponse.json().theme.mode, 'dark');
  assert.equal(updateResponse.json().sync.provider, 'google');

  const memberResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/members',
    payload: { name: 'Alex', role: 'child' },
  });

  assert.equal(memberResponse.statusCode, 201);
  assert.equal(memberResponse.json().name, 'Alex');

  const emailResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/settings/test-email',
    payload: { to: 'qa@local.test' },
  });

  assert.equal(emailResponse.statusCode, 200);
  assert.equal(emailResponse.json().ok, true);

  const syncResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/run',
    payload: {
      provider: 'invite-mail',
      calendarId: DEMO_CALENDAR_IDS.family,
      ownerMemberId: DEMO_MEMBER_IDS.mom,
      rawContent: [
        'Subject: Family invite',
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        'SUMMARY:Imported from mail',
        'DTSTART:20260429T080000Z',
        'DTEND:20260429T090000Z',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    },
  });

  assert.equal(syncResponse.statusCode, 200);
  assert.equal(syncResponse.json().importedCount, 1);

  await app.close();
});

test('settings update rejects disconnected non-none sync provider', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    payload: {
      sync: {
        provider: 'google',
        isConnected: false,
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /Connect the selected sync provider/i);

  await app.close();
});

test('entries occurrences rejects invalid date ranges', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/entries/occurrences?from=not-a-date&to=also-not-a-date',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'Invalid date range');

  await app.close();
});

test('delete endpoints return 404 when entities do not exist', async () => {
  const app = await createTestApp();

  const entryDelete = await app.inject({
    method: 'DELETE',
    url: '/api/v1/entries/does-not-exist',
  });

  assert.equal(entryDelete.statusCode, 404);
  assert.equal(entryDelete.json().message, 'Entry not found');

  const foodDelete = await app.inject({
    method: 'DELETE',
    url: '/api/v1/food-plan',
    payload: {
      weekStart: '2026-04-20',
      day: 'monday',
    },
  });

  assert.equal(foodDelete.statusCode, 404);
  assert.equal(foodDelete.json().message, 'Food plan item not found');

  await app.close();
});

test('food plan delete works with query params and ISO datetime weekStart', async () => {
  const app = await createTestApp();

  const upsertResponse = await app.inject({
    method: 'PUT',
    url: '/api/v1/food-plan',
    payload: {
      weekStart: '2026-04-20',
      day: 'monday',
      dishName: 'Pasta',
      groceryList: ['Tomato'],
    },
  });
  assert.equal(upsertResponse.statusCode, 200);

  const deleteResponse = await app.inject({
    method: 'DELETE',
    url: '/api/v1/food-plan?weekStart=2026-04-20T00:00:00.000Z&day=monday',
  });
  assert.equal(deleteResponse.statusCode, 204);

  const listResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/food-plan?weekStart=2026-04-20',
  });
  assert.equal(listResponse.statusCode, 200);
  assert.equal(listResponse.json().items.length, 0);

  await app.close();
});

test('member patch validates empty name and returns 400', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'PATCH',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.mom}`,
    payload: {
      name: '   ',
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().message, 'Name cannot be empty');

  await app.close();
});

test('member delete removes target member and returns 204', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}`,
  });

  assert.equal(response.statusCode, 204);

  const membersAfterDelete = await app.inject({
    method: 'GET',
    url: '/api/v1/members',
  });

  assert.equal(membersAfterDelete.statusCode, 200);
  assert.equal(membersAfterDelete.json().some((member: { id: string }) => member.id === DEMO_MEMBER_IDS.saga), false);

  await app.close();
});

test('member delete blocks self delete when actorMemberId matches target', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'DELETE',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.mom}?actorMemberId=${DEMO_MEMBER_IDS.mom}`,
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /cannot delete your own member account/i);

  await app.close();
});

test('assistant confirm validates missing date fields with 400', async () => {
  const app = await createTestApp();

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/assistant/confirm',
    payload: {
      draft: {
        type: 'event',
        title: 'Incomplete draft',
        ownerMemberId: DEMO_MEMBER_IDS.mom,
        calendarId: DEMO_CALENDAR_IDS.family,
        timezone: 'Europe/Copenhagen',
        allDay: false,
        reminders: [{ minutesBefore: 30 }],
      },
    },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().message, /missing a start or end time/i);

  await app.close();
});

test('timeline is generated from member task entries for today', async () => {
  const app = await createTestApp();
  const date = '2026-04-24';

  const settingsResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/timeline-settings`,
    payload: {
      enabled: true,
      maxTasksPerDay: 10,
    },
  });
  assert.equal(settingsResponse.statusCode, 200);

  const firstTask = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Pack school bag',
      type: 'task',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: `${date}T07:30:00.000Z`,
      endTime: `${date}T08:00:00.000Z`,
      timezone: 'UTC',
      allDay: false,
      reminders: [],
    },
  });
  assert.equal(firstTask.statusCode, 201);

  const secondTask = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Put shoes by door',
      type: 'task',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: `${date}T09:00:00.000Z`,
      endTime: `${date}T09:15:00.000Z`,
      timezone: 'UTC',
      allDay: false,
      reminders: [],
    },
  });
  assert.equal(secondTask.statusCode, 201);

  const timeline = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(timeline.statusCode, 200);
  assert.deepEqual(
    timeline.json().timeline.tasks.map((task: { title: string; source: string; linkedEntryId?: string }) => ({
      title: task.title,
      source: task.source,
      linkedEntryId: task.linkedEntryId,
    })),
    [
      { title: 'Pack school bag', source: 'entry_task', linkedEntryId: firstTask.json().id },
      { title: 'Put shoes by door', source: 'entry_task', linkedEntryId: secondTask.json().id },
    ],
  );

  await app.close();
});

test('deleting a generated entry task keeps it removed from the same day timeline', async () => {
  const app = await createTestApp();
  const date = '2026-04-24';

  const settingsResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/timeline-settings`,
    payload: {
      enabled: true,
      maxTasksPerDay: 10,
    },
  });
  assert.equal(settingsResponse.statusCode, 200);

  const taskResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Pack school bag',
      type: 'task',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: `${date}T07:45:00.000Z`,
      endTime: `${date}T08:00:00.000Z`,
      timezone: 'UTC',
      allDay: false,
      reminders: [],
    },
  });
  assert.equal(taskResponse.statusCode, 201);

  const initialTimeline = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(initialTimeline.statusCode, 200);
  assert.equal(initialTimeline.json().timeline.tasks.length, 1);

  const deleteTaskResponse = await app.inject({
    method: 'DELETE',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline/tasks/${initialTimeline.json().timeline.tasks[0].id}`,
  });
  assert.equal(deleteTaskResponse.statusCode, 204);

  const refreshedTimeline = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(refreshedTimeline.statusCode, 200);
  assert.equal(refreshedTimeline.json().timeline.tasks.length, 0);

  await app.close();
});

test.skip('timeline confirmation is blocked until the due time is reached', async () => {
  const app = await createTestApp();
  const futureDueAt = new Date(Date.now() + (2 * 60 * 60 * 1000));
  const date = futureDueAt.toISOString().slice(0, 10);
  const expectedTime = futureDueAt.toISOString().slice(11, 16);

  const settingsResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/timeline-settings`,
    payload: {
      enabled: true,
      maxTasksPerDay: 10,
    },
  });
  assert.equal(settingsResponse.statusCode, 200);

  const taskResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'Leave for school',
      type: 'task',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: `${date}T${expectedTime}:00.000Z`,
      endTime: `${date}T${expectedTime}:59.000Z`,
      timezone: 'UTC',
      allDay: false,
      reminders: [],
    },
  });
  assert.equal(taskResponse.statusCode, 201);

  const timelineResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(timelineResponse.statusCode, 200);
  assert.equal(timelineResponse.json().timeline.tasks[0].status, 'pending');

  const confirmResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline/confirm`,
    payload: {
      taskId: timelineResponse.json().timeline.tasks[0].id,
    },
  });
  assert.equal(confirmResponse.statusCode, 400);
  assert.match(confirmResponse.json().message, /cannot be completed before its scheduled time/i);

  const refreshedTimeline = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(refreshedTimeline.statusCode, 200);
  assert.equal(refreshedTimeline.json().timeline.tasks[0].status, 'pending');

  await app.close();
});

test('timeline confirmation rejects unknown task ids deterministically', async () => {
  const app = await createTestApp();
  const date = '2026-04-24';

  const settingsResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/timeline-settings`,
    payload: {
      enabled: true,
      maxTasksPerDay: 10,
    },
  });
  assert.equal(settingsResponse.statusCode, 200);

  const timelineResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(timelineResponse.statusCode, 200);

  const confirmResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline/confirm`,
    payload: {
      taskId: 'non-existent-task-id',
    },
  });

  assert.equal(confirmResponse.statusCode, 404);
  assert.match(confirmResponse.json().message, /not found/i);

  await app.close();
});

test('GET /api/v1/sync/connections returns empty list in in-memory mode', async () => {
  const app = await createTestApp();
  const response = await app.inject({ method: 'GET', url: '/api/v1/sync/connections' });
  // In-memory mode has no auth, so the endpoint is accessible and returns an empty list
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), []);
  await app.close();
});

test('POST /api/v1/sync/connections/verify returns 400 with bad credentials in in-memory mode', async () => {
  const app = await createTestApp();
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/sync/connections/verify',
    payload: { provider: 'apple', appleId: 'test@icloud.com', appPassword: 'xxxx' },
  });
  // In-memory mode has no auth; the verify stub always returns false → 400
  assert.equal(response.statusCode, 400);
  await app.close();
});

test('timeline includes checklist tasks from member events', async () => {
  const app = await createTestApp();
  const date = '2026-04-24';

  const settingsResponse = await app.inject({
    method: 'PUT',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/timeline-settings`,
    payload: {
      enabled: true,
      maxTasksPerDay: 10,
    },
  });
  assert.equal(settingsResponse.statusCode, 200);

  const eventResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/entries',
    payload: {
      title: 'After school routine',
      type: 'event',
      ownerMemberId: DEMO_MEMBER_IDS.saga,
      calendarId: DEMO_CALENDAR_IDS.family,
      startTime: `${date}T16:30:00.000Z`,
      endTime: `${date}T17:00:00.000Z`,
      timezone: 'UTC',
      allDay: false,
      reminders: [],
      checklist: [
        { text: 'Put lunchbox in sink', isCompleted: false },
      ],
    },
  });
  assert.equal(eventResponse.statusCode, 201);

  const timelineResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/members/${DEMO_MEMBER_IDS.saga}/today-timeline?date=${date}`,
  });
  assert.equal(timelineResponse.statusCode, 200);
  assert.deepEqual(
    timelineResponse.json().timeline.tasks.map((task: { title: string; source: string; linkedEntryId?: string }) => ({
      title: task.title,
      source: task.source,
      linkedEntryId: task.linkedEntryId,
    })),
    [
      {
        title: 'Put lunchbox in sink',
        source: 'event_derived_task',
        linkedEntryId: `${eventResponse.json().id}#checklist:${eventResponse.json().checklist[0].id}`,
      },
    ],
  );

  await app.close();
});
