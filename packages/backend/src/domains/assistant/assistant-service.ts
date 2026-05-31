import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
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
  GroceryItem,
  Member,
} from '@mental-load/contracts';

// Haiku for parse/fallback (fast, cheap). Sonnet for chat (user is waiting, quality matters).
const CLAUDE_MODEL_CHAT = 'claude-sonnet-4-6';
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

interface RuntimeConfig {
  provider?: AiProvider;
  /** Anthropic API key (settings override > ANTHROPIC_API_KEY env) */
  apiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  ollamaUrl?: string;
  ollamaModel?: string;
  tone?: string;
  customInstructions?: string;
  _chatModel?: string; // internal: override model for chat calls
}

export class AssistantService {
  constructor(
    private readonly listMembers: () => Promise<Member[]>,
    private readonly listCalendars: () => Promise<Calendar[]>,
    private readonly createEntry: (input: CreateEntryRequest) => Promise<unknown>,
    private readonly getAssistantRuntimeConfig?: () => Promise<RuntimeConfig>,
    private readonly listUpcomingEntries?: (from: string, to: string) => Promise<Entry[]>,
    private readonly getCurrentFoodPlan?: (weekStart: string) => Promise<FoodPlanItem[]>,
    private readonly getFamilyName?: () => Promise<string | null>,
    private readonly getCurrentGroceryList?: (weekStart: string) => Promise<GroceryItem[]>,
    private readonly getAiMemories?: () => Promise<Array<{ memberId?: string; key: string; value: string }>>,
  ) {}

  private resolveAnthropicKey(cfg: RuntimeConfig): string | undefined {
    return cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  }

  private resolveProvider(cfg: RuntimeConfig): AiProvider {
    const explicit = cfg.provider;
    if (explicit && explicit !== 'none') return explicit;
    // Auto-detect from available keys
    if (this.resolveAnthropicKey(cfg)) return 'claude';
    if (cfg.openaiApiKey?.trim()) return 'openai';
    if (cfg.ollamaUrl?.trim()) return 'ollama';
    return 'none';
  }

  private async buildSystemPrompt(cfg: RuntimeConfig): Promise<string | undefined> {
    try {
      const [members, familyName, memories] = await Promise.all([
        this.listMembers(),
        this.getFamilyName?.() ?? null,
        this.getAiMemories?.().catch(() => []) ?? [],
      ]);

      const tone = cfg.tone === 'formal' ? 'formel' : 'uformel og venlig';
      const family = familyName ? `familien ${familyName}` : 'familien';

      // Build member list with their known facts from AI memory
      const memberList = members.map(m => {
        const role = m.role === 'parent' ? 'forælder' : 'barn';
        const facts = (memories as Array<{ memberId?: string; key: string; value: string }>)
          .filter(mem => mem.memberId === m.id)
          .map(mem => `${mem.key}: ${mem.value}`)
          .join('; ');
        return facts ? `${m.name} (${role} — ${facts})` : `${m.name} (${role})`;
      }).join(', ');

      // Family-wide facts
      const familyFacts = (memories as Array<{ memberId?: string; key: string; value: string }>)
        .filter(mem => !mem.memberId)
        .map(mem => `${mem.key}: ${mem.value}`)
        .join('; ');

      const lines: string[] = [
        `Du er en hjælpsom familie-assistent for ${family}.`,
        `Familiemedlemmer: ${memberList || 'ingen endnu'}.`,
        ...(familyFacts ? [`Familiefacts: ${familyFacts}.`] : []),
        `Svar ALTID på dansk. Vær ${tone}.`,
        `VIGTIGT: Skriv ALDRIG JSON, kode eller tekniske formater i dine svar — hverken i kodeblokke eller løbende tekst.`,
        `Beskriv kun hvad du vil gøre i naturligt dansk sprog. Fx: "Jeg opretter opgaven 'Udfyld madplan' med disse delopgaver: Mandag, Tirsdag, Onsdag."`,
      ];

      if (cfg.customInstructions?.trim()) lines.push(cfg.customInstructions.trim());

      const now = new Date();
      const upcomingEntries = await this.listUpcomingEntries?.(
        now.toISOString(),
        new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      ).catch(() => []);

      const DAYS_DA = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
      if (upcomingEntries && upcomingEntries.length > 0) {
        lines.push('', 'Kommende begivenheder (næste 7 dage):');
        for (const e of upcomingEntries.slice(0, 15)) {
          const s = new Date(e.startTime);
          lines.push(`- ${DAYS_DA[s.getUTCDay()]} ${s.getUTCDate()}/${s.getUTCMonth() + 1}: ${e.title}${e.allDay ? '' : ` kl. ${String(s.getUTCHours()).padStart(2, '0')}:${String(s.getUTCMinutes()).padStart(2, '0')}`}`);
        }
      } else {
        lines.push('', 'Ingen kommende begivenheder de næste 7 dage.');
      }

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
      const fmt = (items: FoodPlanItem[] | undefined, label: string) => {
        if (!items?.length) return `${label}: (ingen madplan)`;
        const b: Record<string, string> = {};
        for (const it of items) b[it.day] = it.dishName;
        return `${label}: ${DAYS_ORDER.map(d => `${DAYS_DA_SHORT[d]}: ${b[d] ?? '(ikke planlagt)'}`).join(', ')}`;
      };

      lines.push('', 'Madplan:');
      lines.push(fmt(thisWeek as FoodPlanItem[] | undefined, 'Denne uge'));
      lines.push(fmt(nextWeek as FoodPlanItem[] | undefined, 'Næste uge'));

      // Grocery list — current week's unchecked items
      const groceries = await this.getCurrentGroceryList?.(currentWeekStart).catch(() => []);
      if (groceries && groceries.length > 0) {
        const pending = groceries.filter(g => !g.completed);
        const done = groceries.filter(g => g.completed);
        lines.push('', 'Indkøbsliste (denne uge):');
        if (pending.length > 0) lines.push(`  Mangler: ${pending.map(g => g.text).join(', ')}`);
        if (done.length > 0) lines.push(`  I kurven: ${done.map(g => g.text).join(', ')}`);
      } else {
        lines.push('', 'Indkøbsliste: (tom)');
      }

      return lines.join('\n');
    } catch {
      return undefined;
    }
  }

  async parseRequest(input: AssistantParseRequest): Promise<AssistantParseResponse> {
    const members = await this.listMembers();
    const calendars = await this.listCalendars();
    const timezone = process.env.DEFAULT_TIMEZONE ?? 'Europe/Copenhagen';
    const cfg = await this.getAssistantRuntimeConfig?.() ?? {};

    const initialDraft = input.existingDraft
      ? { ...input.existingDraft, ownerMemberId: input.memberId, calendarId: input.calendarId, timezone: input.existingDraft.timezone ?? timezone }
      : createBaseDraft(input, timezone);

    const interpreted = interpretMessage(input.message, initialDraft, members, calendars);
    if (interpreted.missingFields.length === 0) return interpreted;
    if (interpreted.missingFields.includes('date/time') && !hasTemporalHint(input.message)) return interpreted;

    const provider = this.resolveProvider(cfg);
    const aiResult = await tryAiFallback(input, initialDraft, provider, cfg);
    if (aiResult && aiResult.missingFields.length < interpreted.missingFields.length) return aiResult;

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
    const cfg = await this.getAssistantRuntimeConfig?.() ?? {};
    const provider = this.resolveProvider(cfg);
    const systemPrompt = await this.buildSystemPrompt(cfg);
    // Use Sonnet for chat — user is waiting, quality matters more than cost
    const reply = await callAiChat(input.message, systemPrompt, provider, { ...cfg, _chatModel: CLAUDE_MODEL_CHAT });
    if (reply) return { source: provider as AssistantFunResponse['source'], response: reply };
    return { source: 'rule-based', response: buildFunFallback(input.message) };
  }

  async getStatus(): Promise<AssistantStatusResponse> {
    const cfg = await this.getAssistantRuntimeConfig?.() ?? {};
    const provider = this.resolveProvider(cfg);
    return buildStatus(provider, cfg);
  }
}

// ── Provider routing ─────────────────────────────────────────────────────────

async function callAiChat(
  message: string,
  systemPrompt: string | undefined,
  provider: AiProvider,
  cfg: RuntimeConfig,
): Promise<string | undefined> {
  if (provider === 'claude') return callClaude(message, systemPrompt, cfg);
  if (provider === 'openai') return callOpenAI(message, systemPrompt, cfg);
  if (provider === 'ollama') return callOllama(message, systemPrompt, cfg);
  return undefined;
}

async function tryAiFallback(
  input: AssistantParseRequest,
  baseDraft: AssistantDraft,
  provider: AiProvider,
  cfg: RuntimeConfig,
): Promise<AssistantParseResponse | undefined> {
  if (provider === 'none') return undefined;

  const prompt = [
    'Extract a scheduling draft as JSON with keys: title, type (event|task), startTime (ISO), endTime (ISO), allDay (bool), recurrenceRule, location.',
    'Return only valid JSON, no explanation.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Message: ${input.message}`,
  ].join('\n');

  let text: string | undefined;
  if (provider === 'claude') text = await callClaude(prompt, undefined, cfg);
  else if (provider === 'openai') text = await callOpenAI(prompt, undefined, cfg);
  else if (provider === 'ollama') text = await callOllama(prompt, undefined, cfg);

  if (!text) return undefined;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const parsed = JSON.parse(jsonMatch[0]) as Partial<AssistantDraft>;
    const draft: AssistantDraft = { ...baseDraft, ...parsed };
    const missingFields: string[] = [];
    if (!draft.startTime || !draft.endTime) missingFields.push('date/time');
    if (!draft.title || draft.title === 'Untitled entry') missingFields.push('title');
    return {
      source: provider,
      response: missingFields.length === 0 ? 'I prepared an AI-assisted draft. Confirm to save it.' : 'I still need a little more detail.',
      requiresConfirmation: true,
      missingFields,
      draft,
    };
  } catch {
    return undefined;
  }
}

// ── Claude (Anthropic) ───────────────────────────────────────────────────────

async function callClaude(
  message: string,
  systemPrompt: string | undefined,
  cfg: RuntimeConfig,
): Promise<string | undefined> {
  const apiKey = cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return undefined;
  try {
    const client = new Anthropic({ apiKey, timeout: 30000 });
    const model = cfg._chatModel ?? CLAUDE_MODEL;
    const response = await client.messages.create({
      model,
      max_tokens: model === CLAUDE_MODEL_CHAT ? 1024 : 512,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: [{ role: 'user', content: message }],
    });
    const block = response.content[0];
    return block.type === 'text' ? block.text.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

async function callOpenAI(
  message: string,
  systemPrompt: string | undefined,
  cfg: RuntimeConfig,
): Promise<string | undefined> {
  const apiKey = cfg.openaiApiKey?.trim();
  if (!apiKey) return undefined;
  const model = cfg.openaiModel?.trim() || DEFAULT_OPENAI_MODEL;
  try {
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: message });

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 512 }),
    });
    if (!res.ok) return undefined;
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Ollama (remote) ──────────────────────────────────────────────────────────

async function callOllama(
  message: string,
  systemPrompt: string | undefined,
  cfg: RuntimeConfig,
): Promise<string | undefined> {
  const url = cfg.ollamaUrl?.trim();
  if (!url) return undefined;
  const model = cfg.ollamaModel?.trim() || 'llama3.2:3b';
  try {
    if (systemPrompt) {
      const res = await fetch(`${url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, stream: false,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        }),
      });
      if (!res.ok) return undefined;
      const data = await res.json() as { message?: { content?: string } };
      return data.message?.content?.trim() || undefined;
    }
    const res = await fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: false, prompt: message }),
    });
    if (!res.ok) return undefined;
    const data = await res.json() as { response?: string };
    return data.response?.trim() || undefined;
  } catch {
    return undefined;
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

function buildStatus(provider: AiProvider, cfg: RuntimeConfig): AssistantStatusResponse {
  if (provider === 'none') {
    return { ok: false, enabled: false, reachable: false, modelAvailable: false, provider: 'rule-based', message: 'No AI provider configured. Using rule-based fallback.' };
  }
  if (provider === 'claude') {
    const hasKey = !!(cfg.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim());
    return { ok: hasKey, enabled: true, reachable: hasKey, modelAvailable: hasKey, provider: 'claude', modelName: CLAUDE_MODEL, message: hasKey ? `Claude ready (${CLAUDE_MODEL}).` : 'Anthropic API key not set.' };
  }
  if (provider === 'openai') {
    const hasKey = !!cfg.openaiApiKey?.trim();
    const model = cfg.openaiModel?.trim() || DEFAULT_OPENAI_MODEL;
    return { ok: hasKey, enabled: true, reachable: hasKey, modelAvailable: hasKey, provider: 'openai', modelName: model, message: hasKey ? `OpenAI ready (${model}).` : 'OpenAI API key not set.' };
  }
  if (provider === 'ollama') {
    const hasUrl = !!cfg.ollamaUrl?.trim();
    const model = cfg.ollamaModel?.trim() || 'llama3.2:3b';
    return { ok: hasUrl, enabled: true, reachable: hasUrl, modelAvailable: hasUrl, provider: 'ollama', modelName: model, message: hasUrl ? `Ollama ready at ${cfg.ollamaUrl} (${model}).` : 'Ollama URL not set.' };
  }
  return { ok: false, enabled: false, reachable: false, modelAvailable: false, provider: 'rule-based', message: 'Unknown provider.' };
}

// ── Deterministic NLP ────────────────────────────────────────────────────────

function hasTemporalHint(message: string): boolean {
  return /(today|tomorrow|i dag|i morgen|monday|tuesday|wednesday|thursday|friday|saturday|sunday|søndag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag)/i.test(message)
    || /(\d{1,2})[./-](\d{1,2})([./-](\d{2,4}))?/i.test(message)
    || /(?:at|kl\.?|@)\s*\d{1,2}(?::|\.)?\d{0,2}/i.test(message);
}

function createBaseDraft(input: AssistantParseRequest, timezone: string): AssistantDraft {
  return { type: 'event', title: 'Untitled entry', ownerMemberId: input.memberId, calendarId: input.calendarId, timezone, allDay: false, reminders: [{ minutesBefore: 30 }] };
}

function interpretMessage(message: string, baseDraft: AssistantDraft, members: Member[], calendars: Calendar[]): AssistantParseResponse {
  const normalized = message.trim();
  const lower = normalized.toLowerCase();
  const draft: AssistantDraft = { ...baseDraft };

  if (/(task|todo|opgave)/i.test(normalized)) { draft.type = 'task'; draft.allDay = true; }

  const matchedCalendar = calendars.find(c => lower.includes(c.name.toLowerCase()));
  if (matchedCalendar) draft.calendarId = matchedCalendar.id;

  const matchedMember = members.find(m => lower.includes(m.name.toLowerCase()));
  if (matchedMember) draft.ownerMemberId = matchedMember.id;

  const lastColon = normalized.lastIndexOf(':');
  const titleAfterColon = lastColon >= 0 ? normalized.slice(lastColon + 1).trim() : '';
  if (isMeaningfulTitle(titleAfterColon)) {
    draft.title = titleAfterColon;
  } else {
    const cleaned = normalized.replace(/(make|create|add|plan|lav|opret|tilføj)\s+(an\s+|a\s+)?(event|task|todo|opgave)/gi, '').replace(/(today|tomorrow|i dag|i morgen|on|at|kl\.?|every|hver).*/gi, '').trim();
    if (isMeaningfulTitle(cleaned)) draft.title = cleaned.replace(/^[:-]\s*/, '');
  }

  const parsedTime = parseTimeExpression(normalized);
  const parsedDate = parseDateExpression(lower) ?? (parsedTime && draft.startTime ? new Date(draft.startTime) : undefined);

  if (parsedDate) {
    const start = new Date(parsedDate); const end = new Date(parsedDate);
    if (parsedTime) {
      start.setUTCHours(parsedTime.hours, parsedTime.minutes, 0, 0);
      end.setUTCHours(parsedTime.hours + 1, parsedTime.minutes, 0, 0);
      draft.allDay = false;
    } else {
      start.setUTCHours(9, 0, 0, 0); end.setUTCHours(10, 0, 0, 0);
      draft.allDay = draft.type === 'task';
    }
    draft.startTime = start.toISOString(); draft.endTime = end.toISOString();
  }

  if (/(every week|weekly|hver uge)/i.test(normalized)) draft.recurrenceRule = 'FREQ=WEEKLY;COUNT=6';
  else if (/(every day|daily|hver dag)/i.test(normalized)) draft.recurrenceRule = 'FREQ=DAILY;COUNT=5';

  if (/birthday|fødselsdag/i.test(normalized)) draft.reminders = [{ minutesBefore: 1440 }];

  const missingFields = [] as string[];
  if (!draft.startTime || !draft.endTime) missingFields.push('date/time');
  if (!draft.title || draft.title === 'Untitled entry') missingFields.push('title');

  return {
    source: 'rule-based',
    response: missingFields.length === 0 ? `I prepared a ${draft.type} draft for ${draft.title}. Confirm to save it.` : `I updated the draft and still need ${missingFields.join(' and ')} before I can finalize this plan.`,
    requiresConfirmation: true,
    missingFields,
    draft,
  };
}

function isMeaningfulTitle(v: string): boolean {
  const t = v.trim();
  if (!t) return false;
  if (/^(\d{1,2})(?::|\.)(\d{2})$/.test(t)) return false;
  return /[A-Za-zÆØÅæøå]/.test(t);
}

function parseDateExpression(message: string): Date | undefined {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (/(today|i dag)/i.test(message)) return today;
  if (/(tomorrow|i morgen)/i.test(message)) { const r = new Date(today); r.setUTCDate(r.getUTCDate() + 1); return r; }
  const explicit = message.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (explicit) return new Date(Date.UTC(Number(explicit[3]), Number(explicit[2]) - 1, Number(explicit[1])));
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const danishWeekdays = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
  const idx = weekdays.findIndex(d => message.includes(d));
  const daIdx = danishWeekdays.findIndex(d => message.includes(d));
  const wi = idx >= 0 ? idx : daIdx;
  if (wi >= 0) { const r = new Date(today); const delta = (wi - r.getUTCDay() + 7) % 7 || 7; r.setUTCDate(r.getUTCDate() + delta); return r; }
  return undefined;
}

function parseTimeExpression(message: string): { hours: number; minutes: number } | undefined {
  const m = message.match(/(?:at|kl\.?|@)\s*(\d{1,2})(?::|\.)(\d{2})|(?:at|kl\.?|@)\s*(\d{1,2})\b/i);
  if (!m) return undefined;
  const hours = Number(m[1] ?? m[3]); const minutes = Number(m[2] ?? '00');
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return undefined;
  return { hours, minutes };
}

function buildFunFallback(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('joke') || lower.includes('fun')) return 'MentalLoad says: the family that plans together has more time left for cake.';
  if (lower.includes('birthday')) return 'Birthday mode is ready: I can help remember the date, the cake, and the gift task.';
  return `MentalLoad playground: ${message.trim() || 'Ready for a cheerful family-planning prompt.'}`;
}

function getMondayStr(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
