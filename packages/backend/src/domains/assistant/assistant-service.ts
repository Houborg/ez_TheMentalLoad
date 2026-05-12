import type {
  AssistantStatusResponse,
  AssistantConfirmRequest,
  AssistantDraft,
  AssistantFunRequest,
  AssistantFunResponse,
  AssistantParseRequest,
  AssistantParseResponse,
  Calendar,
  CreateEntryRequest,
  Entry,
  FoodPlanItem,
  Member,
} from '@mental-load/contracts';

export class AssistantService {
  constructor(
    private readonly listMembers: () => Promise<Member[]>,
    private readonly listCalendars: () => Promise<Calendar[]>,
    private readonly createEntry: (input: CreateEntryRequest) => Promise<unknown>,
    private readonly getAssistantRuntimeConfig?: () => Promise<{
      ollamaUrl?: string;
      modelName?: string;
      tone?: string;
      customInstructions?: string;
    }>,
    private readonly listUpcomingEntries?: (from: string, to: string) => Promise<Entry[]>,
    private readonly getCurrentFoodPlan?: (weekStart: string) => Promise<FoodPlanItem[]>,
    private readonly getFamilyName?: () => Promise<string | null>,
  ) {}

  private async buildSystemPrompt(runtimeConfig?: {
    ollamaUrl?: string; modelName?: string; tone?: string; customInstructions?: string;
  }): Promise<string | undefined> {
    try {
      const [members, familyName] = await Promise.all([
        this.listMembers(),
        this.getFamilyName?.() ?? null,
      ]);

      const tone = runtimeConfig?.tone === 'formal' ? 'formel' : 'uformel og venlig';
      const memberList = members.map(m => `${m.name} (${m.role === 'parent' ? 'forælder' : 'barn'})`).join(', ');
      const family = familyName ? `familien ${familyName}` : 'familien';

      const lines: string[] = [
        `Du er en hjælpsom familie-assistent for ${family}.`,
        `Familiemedlemmer: ${memberList || 'ingen endnu'}.`,
        `Svar på dansk. Vær ${tone}.`,
      ];

      if (runtimeConfig?.customInstructions?.trim()) {
        lines.push(runtimeConfig.customInstructions.trim());
      }

      // Calendar snapshot — next 7 days
      const now = new Date();
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const upcomingEntries = await this.listUpcomingEntries?.(
        now.toISOString(),
        in7Days.toISOString(),
      ).catch(() => []);

      const DAYS_DA = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
      if (upcomingEntries && upcomingEntries.length > 0) {
        lines.push('');
        lines.push('Kommende begivenheder (næste 7 dage):');
        for (const entry of upcomingEntries.slice(0, 15)) {
          const start = new Date(entry.startTime);
          const day = DAYS_DA[start.getUTCDay()];
          const date = `${start.getUTCDate()}/${start.getUTCMonth() + 1}`;
          const time = entry.allDay ? '' : ` kl. ${String(start.getUTCHours()).padStart(2, '0')}:${String(start.getUTCMinutes()).padStart(2, '0')}`;
          lines.push(`- ${day} ${date}: ${entry.title}${time}`);
        }
      } else {
        lines.push('');
        lines.push('Ingen kommende begivenheder de næste 7 dage.');
      }

      // Food plan snapshot — this week + next week
      const currentWeekStart = getMondayStr(now);
      const nextWeekStart = getMondayStr(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));
      const [thisWeek, nextWeek] = await Promise.all([
        this.getCurrentFoodPlan?.(currentWeekStart).catch(() => []),
        this.getCurrentFoodPlan?.(nextWeekStart).catch(() => []),
      ]);

      const DAYS_ORDER = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const DAYS_DA_SHORT: Record<string, string> = {
        monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag',
        thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
      };

      const formatWeek = (items: FoodPlanItem[] | undefined, label: string): string => {
        if (!items || items.length === 0) return `${label}: (ingen madplan)`;
        const byDay: Record<string, string> = {};
        for (const item of items) byDay[item.day] = item.dishName;
        const parts = DAYS_ORDER.map(d => `${DAYS_DA_SHORT[d]}: ${byDay[d] ?? '(ikke planlagt)'}`);
        return `${label}: ${parts.join(', ')}`;
      };

      lines.push('');
      lines.push('Madplan:');
      lines.push(formatWeek(thisWeek as FoodPlanItem[] | undefined, 'Denne uge'));
      lines.push(formatWeek(nextWeek as FoodPlanItem[] | undefined, 'Næste uge'));

      return lines.join('\n');
    } catch {
      return undefined;
    }
  }

  async parseRequest(input: AssistantParseRequest): Promise<AssistantParseResponse> {
    const members = await this.listMembers();
    const calendars = await this.listCalendars();
    const timezone = process.env.DEFAULT_TIMEZONE ?? 'Europe/Copenhagen';

    const initialDraft = input.existingDraft
      ? {
          ...input.existingDraft,
          ownerMemberId: input.memberId,
          calendarId: input.calendarId,
          timezone: input.existingDraft.timezone ?? timezone,
        }
      : createBaseDraft(input, timezone);
    const interpreted = interpretMessage(input.message, initialDraft, members, calendars);

    if (interpreted.missingFields.length === 0) {
      return interpreted;
    }

    // Keep draft completion deterministic when the user did not provide any temporal clue.
    // This avoids an LLM from inventing dates/times for prompts like "add task: ...".
    if (interpreted.missingFields.includes('date/time') && !hasTemporalHint(input.message)) {
      return interpreted;
    }

    const runtimeConfig = await this.getAssistantRuntimeConfig?.();
    const ollamaDraft = await tryOllamaFallback(input, initialDraft, runtimeConfig);
    if (ollamaDraft && ollamaDraft.missingFields.length < interpreted.missingFields.length) {
      return ollamaDraft;
    }

    return interpreted;
  }

  async confirmDraft(input: AssistantConfirmRequest): Promise<unknown> {
    if (!input.draft.startTime || !input.draft.endTime) {
      throw new Error('Assistant draft is missing a start or end time.');
    }

    return this.createEntry({
      title: input.draft.title,
      type: input.draft.type,
      ownerMemberId: input.draft.ownerMemberId,
      calendarId: input.draft.calendarId,
      startTime: input.draft.startTime,
      endTime: input.draft.endTime,
      timezone: input.draft.timezone,
      allDay: input.draft.allDay,
      recurrenceRule: input.draft.recurrenceRule,
      location: input.draft.location,
      reminders: input.draft.reminders,
    });
  }

  async funChat(input: AssistantFunRequest): Promise<AssistantFunResponse> {
    const runtimeConfig = await this.getAssistantRuntimeConfig?.();
    const systemPrompt = await this.buildSystemPrompt(runtimeConfig);
    const ollamaResponse = await tryOllamaChat(input.message, runtimeConfig, systemPrompt);
    if (ollamaResponse) {
      return { source: 'ollama-fallback', response: ollamaResponse };
    }
    return { source: 'rule-based', response: buildFunFallback(input.message) };
  }

  async getStatus(): Promise<AssistantStatusResponse> {
    const runtimeConfig = await this.getAssistantRuntimeConfig?.();
    return checkOllamaStatus(runtimeConfig);
  }
}

function hasTemporalHint(message: string): boolean {
  const lower = message.toLowerCase();
  return /(today|tomorrow|i dag|i morgen|monday|tuesday|wednesday|thursday|friday|saturday|sunday|søndag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag)/i.test(lower)
    || /(\d{1,2})[./-](\d{1,2})([./-](\d{2,4}))?/i.test(lower)
    || /(?:at|kl\.?|@)\s*\d{1,2}(?::|\.)?\d{0,2}/i.test(lower);
}

function createBaseDraft(input: AssistantParseRequest, timezone: string): AssistantDraft {
  return {
    type: 'event',
    title: 'Untitled entry',
    ownerMemberId: input.memberId,
    calendarId: input.calendarId,
    timezone,
    allDay: false,
    reminders: [{ minutesBefore: 30 }],
  };
}

function interpretMessage(
  message: string,
  baseDraft: AssistantDraft,
  members: Member[],
  calendars: Calendar[],
): AssistantParseResponse {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const draft: AssistantDraft = { ...baseDraft };

  if (/(task|todo|opgave)/i.test(normalized)) {
    draft.type = 'task';
    draft.allDay = true;
  }

  const matchedCalendar = calendars.find((calendar) => lower.includes(calendar.name.toLowerCase()));
  if (matchedCalendar) {
    draft.calendarId = matchedCalendar.id;
  }

  const matchedMember = members.find((member) => lower.includes(member.name.toLowerCase()));
  if (matchedMember) {
    draft.ownerMemberId = matchedMember.id;
  }

  const lastColonIndex = normalized.lastIndexOf(':');
  const titleAfterColon = lastColonIndex >= 0 ? normalized.slice(lastColonIndex + 1).trim() : '';
  if (isMeaningfulTitle(titleAfterColon)) {
    draft.title = titleAfterColon;
  } else {
    const cleanedTitle = normalized
      .replace(/(make|create|add|plan|lav|opret|tilføj)\s+(an\s+|a\s+)?(event|task|todo|opgave)/gi, '')
      .replace(/(today|tomorrow|i dag|i morgen|on|at|kl\.?|every|hver).*/gi, '')
      .trim();

    if (isMeaningfulTitle(cleanedTitle)) {
      draft.title = cleanedTitle.replace(/^[:-]\s*/, '');
    }
  }

  const parsedTime = parseTimeExpression(normalized);
  const parsedDate = parseDateExpression(lower) ?? (parsedTime && draft.startTime ? new Date(draft.startTime) : undefined);

  if (parsedDate) {
    const start = new Date(parsedDate);
    const end = new Date(parsedDate);

    if (parsedTime) {
      start.setUTCHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      end.setUTCHours(parsedTime.hours + 1, parsedTime.minutes, 0, 0);
      draft.allDay = false;
    } else {
      start.setUTCHours(9, 0, 0, 0);
      end.setUTCHours(10, 0, 0, 0);
      draft.allDay = draft.type === 'task';
    }

    draft.startTime = start.toISOString();
    draft.endTime = end.toISOString();
  }

  if (/(every week|weekly|hver uge)/i.test(normalized)) {
    draft.recurrenceRule = 'FREQ=WEEKLY;COUNT=6';
  } else if (/(every day|daily|hver dag)/i.test(normalized)) {
    draft.recurrenceRule = 'FREQ=DAILY;COUNT=5';
  }

  if (/birthday|fødselsdag/i.test(normalized)) {
    draft.reminders = [{ minutesBefore: 1440 }];
  }

  const missingFields = [] as string[];
  if (!draft.startTime || !draft.endTime) {
    missingFields.push('date/time');
  }
  if (!draft.title || draft.title === 'Untitled entry') {
    missingFields.push('title');
  }

  const response = missingFields.length === 0
    ? `I prepared a ${draft.type} draft for ${draft.title}. Confirm to save it.`
    : `I updated the draft and still need ${missingFields.join(' and ')} before I can finalize this plan.`;

  return {
    source: 'rule-based',
    response,
    requiresConfirmation: true,
    missingFields,
    draft,
  };
}

function isMeaningfulTitle(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (/^(\d{1,2})(?::|\.)(\d{2})$/.test(trimmed)) {
    return false;
  }

  return /[A-Za-zÆØÅæøå]/.test(trimmed);
}

function parseDateExpression(message: string): Date | undefined {
  const now = new Date();
  const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  if (/(today|i dag)/i.test(message)) {
    return startOfDay;
  }

  if (/(tomorrow|i morgen)/i.test(message)) {
    const result = new Date(startOfDay);
    result.setUTCDate(result.getUTCDate() + 1);
    return result;
  }

  const explicitDate = message.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (explicitDate) {
    const [, day, month, year] = explicitDate;
    return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  }

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const danishWeekdays = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
  const index = weekdays.findIndex((day) => message.includes(day));
  const daIndex = danishWeekdays.findIndex((day) => message.includes(day));
  const weekdayIndex = index >= 0 ? index : daIndex;

  if (weekdayIndex >= 0) {
    const result = new Date(startOfDay);
    const delta = (weekdayIndex - result.getUTCDay() + 7) % 7 || 7;
    result.setUTCDate(result.getUTCDate() + delta);
    return result;
  }

  return undefined;
}

function parseTimeExpression(message: string): { hours: number; minutes: number } | undefined {
  const match = message.match(/(?:at|kl\.?|@)\s*(\d{1,2})(?::|\.)(\d{2})|(?:at|kl\.?|@)\s*(\d{1,2})\b/i);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1] ?? match[3]);
  const minutes = Number(match[2] ?? '00');
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return undefined;
  }

  return { hours, minutes };
}

function buildFunFallback(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('joke') || lower.includes('fun')) {
    return 'MentalLoad says: the family that plans together has more time left for cake.';
  }

  if (lower.includes('birthday')) {
    return 'Birthday mode is ready: I can help remember the date, the cake, and the gift task.';
  }

  return `MentalLoad playground: ${message.trim() || 'Ready for a cheerful family-planning prompt.'}`;
}

async function tryOllamaChat(
  message: string,
  runtimeConfig?: { ollamaUrl?: string; modelName?: string },
  systemPrompt?: string,
): Promise<string | undefined> {
  const config = resolveOllamaConfig(runtimeConfig);
  if (!config) return undefined;

  try {
    if (systemPrompt) {
      const response = await fetch(`${config.ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.modelName,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: message },
          ],
        }),
      });
      if (!response.ok) return undefined;
      const payload = (await response.json()) as { message?: { content?: string } };
      return payload.message?.content?.trim() || undefined;
    }

    // Fallback: /api/generate without system context
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelName,
        stream: false,
        prompt: `You are a cheerful family planning assistant. Reply briefly and helpfully. User: ${message}`,
      }),
    });
    if (!response.ok) return undefined;
    const payload = (await response.json()) as { response?: string };
    return payload.response?.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function tryOllamaFallback(
  input: AssistantParseRequest,
  baseDraft: AssistantDraft,
  runtimeConfig?: { ollamaUrl?: string; modelName?: string },
): Promise<AssistantParseResponse | undefined> {
  const config = resolveOllamaConfig(runtimeConfig);
  if (!config) {
    return undefined;
  }

  try {
    const response = await fetch(`${config.ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.modelName,
        stream: false,
        prompt: [
          'Extract a scheduling draft as JSON with keys title, type, startTime, endTime, allDay, recurrenceRule, location.',
          'Use ISO timestamps when possible. Return JSON only.',
          `Message: ${input.message}`,
        ].join('\n'),
      }),
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as { response?: string };
    const parsed = JSON.parse(payload.response ?? '{}') as Partial<AssistantDraft>;
    const draft: AssistantDraft = { ...baseDraft, ...parsed };
    const missingFields: string[] = [];
    if (!draft.startTime || !draft.endTime) {
      missingFields.push('date/time');
    }
    if (!draft.title) {
      missingFields.push('title');
    }

    return {
      source: 'ollama-fallback',
      response: missingFields.length === 0 ? 'I prepared an AI-assisted draft. Confirm to save it.' : 'I still need a little more detail to save this.',
      requiresConfirmation: true,
      missingFields,
      draft,
    };
  } catch {
    return undefined;
  }
}

function resolveOllamaConfig(runtimeConfig?: { ollamaUrl?: string; modelName?: string }): { ollamaUrl: string; modelName: string } | undefined {
  const ollamaUrl = runtimeConfig?.ollamaUrl?.trim() || process.env.OLLAMA_URL?.trim();
  const modelName = runtimeConfig?.modelName?.trim() || process.env.OLLAMA_MODEL?.trim();
  if (!ollamaUrl || !modelName) {
    return undefined;
  }

  return { ollamaUrl, modelName };
}

async function checkOllamaStatus(
  runtimeConfig?: { ollamaUrl?: string; modelName?: string },
): Promise<AssistantStatusResponse> {
  const config = resolveOllamaConfig(runtimeConfig);
  if (!config) {
    return {
      ok: false,
      enabled: false,
      reachable: false,
      modelAvailable: false,
      provider: 'rule-based',
      message: 'Ollama is not configured. The assistant will use rule-based fallback only.',
    };
  }

  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`);
    if (!response.ok) {
      return {
        ok: false,
        enabled: true,
        reachable: false,
        modelAvailable: false,
        provider: 'rule-based',
        ollamaUrl: config.ollamaUrl,
        modelName: config.modelName,
        message: `Ollama is configured but not reachable at ${config.ollamaUrl}.`,
      };
    }

    const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
    const models = payload.models ?? [];
    const modelAvailable = models.some((entry) => entry.name === config.modelName || entry.model === config.modelName);

    return {
      ok: modelAvailable,
      enabled: true,
      reachable: true,
      modelAvailable,
      provider: modelAvailable ? 'ollama' : 'rule-based',
      ollamaUrl: config.ollamaUrl,
      modelName: config.modelName,
      message: modelAvailable
        ? `Ollama is ready with model ${config.modelName}.`
        : `Ollama is reachable, but model ${config.modelName} is not installed.`,
    };
  } catch {
    return {
      ok: false,
      enabled: true,
      reachable: false,
      modelAvailable: false,
      provider: 'rule-based',
      ollamaUrl: config.ollamaUrl,
      modelName: config.modelName,
      message: `Ollama is configured but not reachable at ${config.ollamaUrl}.`,
    };
  }
}

function getMondayStr(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
