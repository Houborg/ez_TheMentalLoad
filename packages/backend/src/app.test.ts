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

test('settings, member management, email preview, and manual sync endpoints work together', async () => {
  const app = await createTestApp();

  const settingsResponse = await app.inject({ method: 'GET', url: '/api/v1/settings' });
  assert.equal(settingsResponse.statusCode, 200);
  assert.equal(settingsResponse.json().theme.mode, 'system');

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
