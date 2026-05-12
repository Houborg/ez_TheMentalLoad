# AI Context & Custom System Prompt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI assistant real family context (members, tone, custom instructions) and live data access (next 7 days calendar + food plan) so it can answer questions like "hvad spiser vi søndag" or "lav en indkøbsliste til mandag".

**Architecture:** `AssistantConfig` gains `tone` and `customInstructions` fields stored in `settings.assistant`. `AssistantService` gets three new optional callbacks (upcoming entries, food plan, family name) and a `buildSystemPrompt()` helper. `funChat` switches from `/api/generate` to `/api/chat` when a system prompt is available. Frontend Settings → Assistant tab gets tone toggle + custom instructions textarea.

**Tech Stack:** Ollama `/api/chat` endpoint, TypeScript, Fastify, Next.js, Tailwind v4.

---

## File Map

**Modify:**
- `packages/contracts/src/domain.ts` — add `tone` + `customInstructions` to `AssistantConfig`
- `packages/backend/src/domains/assistant/assistant-service.ts` — new callbacks, prompt builder, switch to `/api/chat`
- `packages/backend/src/app.ts` — wire new callbacks into `AssistantService` constructor
- `packages/frontend/components/dashboard-app.tsx` — add tone toggle + custom instructions to Assistant settings section

---

## Task 1: Extend AssistantConfig contract

**Files:**
- Modify: `packages/contracts/src/domain.ts`

- [ ] **Step 1: Add tone and customInstructions to AssistantConfig**

Find `AssistantConfig` (around line 83) and add two new optional fields:

```typescript
export interface AssistantConfig {
  id: string;
  modelName: string;
  language: SupportedLanguage;
  enabled: boolean;
  ollamaUrl?: string;
  tone?: 'informal' | 'formal';
  customInstructions?: string;
}
```

- [ ] **Step 2: Typecheck contracts**

```bash
cd packages/contracts && npx tsc --noEmit 2>&1 | head -5
```
Expected: clean (no output).

- [ ] **Step 3: Commit**

```bash
git add packages/contracts/src/domain.ts
git commit -m "feat: add tone + customInstructions to AssistantConfig"
```

---

## Task 2: Update AssistantService — new callbacks + prompt builder + /api/chat

**Files:**
- Modify: `packages/backend/src/domains/assistant/assistant-service.ts`

- [ ] **Step 1: Add Entry and FoodPlanItem imports**

At the top of `assistant-service.ts`, add `Entry` and `FoodPlanItem` to the contracts import:

```typescript
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
```

- [ ] **Step 2: Add new optional callbacks to the constructor**

Replace the constructor signature:

```typescript
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
```

- [ ] **Step 3: Add buildSystemPrompt method**

Add this method to the `AssistantService` class (before `parseRequest`):

```typescript
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

    if (upcomingEntries && upcomingEntries.length > 0) {
      lines.push('');
      lines.push('Kommende begivenheder (næste 7 dage):');
      const DAYS_DA = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];
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

    const DAYS_ORDER: string[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const DAYS_DA_SHORT: Record<string, string> = {
      monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag',
      thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
    };

    lines.push('');
    lines.push('Madplan:');

    const formatWeek = (items: FoodPlanItem[] | undefined, label: string) => {
      if (!items || items.length === 0) return `${label}: (ingen madplan)`;
      const byDay: Record<string, string> = {};
      for (const item of items) byDay[item.day] = item.dishName;
      const parts = DAYS_ORDER.map(d => `${DAYS_DA_SHORT[d]}: ${byDay[d] ?? '(ikke planlagt)'}`);
      return `${label}: ${parts.join(', ')}`;
    };

    lines.push(formatWeek(thisWeek as FoodPlanItem[] | undefined, 'Denne uge'));
    lines.push(formatWeek(nextWeek as FoodPlanItem[] | undefined, 'Næste uge'));

    return lines.join('\n');
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: Add getMondayStr helper function**

Add this standalone helper at the bottom of the file (after the last function):

```typescript
function getMondayStr(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}
```

- [ ] **Step 5: Update funChat to use buildSystemPrompt + /api/chat**

Replace the `funChat` method and `tryOllamaChat` function:

```typescript
async funChat(input: AssistantFunRequest): Promise<AssistantFunResponse> {
  const runtimeConfig = await this.getAssistantRuntimeConfig?.();
  const systemPrompt = await this.buildSystemPrompt(runtimeConfig);
  const ollamaResponse = await tryOllamaChat(input.message, runtimeConfig, systemPrompt);
  if (ollamaResponse) {
    return { source: 'ollama-fallback', response: ollamaResponse };
  }
  return { source: 'rule-based', response: buildFunFallback(input.message) };
}
```

Replace the `tryOllamaChat` function:

```typescript
async function tryOllamaChat(
  message: string,
  runtimeConfig?: { ollamaUrl?: string; modelName?: string },
  systemPrompt?: string,
): Promise<string | undefined> {
  const config = resolveOllamaConfig(runtimeConfig);
  if (!config) return undefined;

  try {
    if (systemPrompt) {
      // Use /api/chat with roles for system-prompted conversations
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
```

- [ ] **Step 6: Typecheck backend**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -15
```
Expected: errors only in `app.ts` (constructor call not yet updated — fixed in Task 3).

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/domains/assistant/assistant-service.ts
git commit -m "feat: AssistantService — system prompt builder, live data callbacks, /api/chat"
```

---

## Task 3: Wire new callbacks in app.ts

**Files:**
- Modify: `packages/backend/src/app.ts`

- [ ] **Step 1: Update AssistantService constructor call in getRequestServices**

Find the `assistantService` construction inside `getRequestServices(familyId)` and replace it:

```typescript
const assistantService = new AssistantService(
  () => repo.memberRepository.list(),
  () => repo.calendarRepository.list(),
  (input) => entryService.createEntry(input),
  async () => {
    const settings = await settingsService.getSettings();
    return {
      ollamaUrl: settings.assistant.ollamaUrl,
      modelName: settings.assistant.modelName,
      tone: settings.assistant.tone,
      customInstructions: settings.assistant.customInstructions,
    };
  },
  // upcoming entries for AI context
  (from, to) => entryService.listOccurrences(from, to),
  // food plan for AI context
  (weekStart) => repo.foodPlanRepository.listByWeek(weekStart),
  // family name for AI context
  async () => {
    if (!infrastructure.pool) return null;
    const result = await infrastructure.pool.query<{ name: string | null }>(
      'select name from families where id = $1',
      [familyId],
    );
    return result.rows[0]?.name ?? null;
  },
);
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/backend && npm run typecheck 2>&1 | head -10
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/app.ts
git commit -m "feat: wire upcoming entries, food plan, family name into AssistantService"
```

---

## Task 4: Frontend — tone toggle + custom instructions in Settings

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Find the assistant settings section**

Search for where `settings.assistant` is rendered in the settings panel. Look for `settingsTab === 'theme'` or nearby — the assistant settings may be embedded in the theme tab or a separate section. Find the block that renders `settings.assistant.modelName` or `settings.assistant.ollamaUrl`.

Run:
```bash
cd packages/frontend && grep -n "modelName\|ollamaUrl\|assistant.*enabled" components/dashboard-app.tsx | head -10
```

Note the line numbers.

- [ ] **Step 2: Add tone toggle and custom instructions**

In the assistant settings section (wherever `settings.assistant` fields are rendered), add after the existing assistant fields:

```tsx
{/* Tone */}
<div className="space-y-1.5">
  <span className="text-sm font-medium">Tone</span>
  <div className="flex gap-2">
    {(['informal', 'formal'] as const).map(t => (
      <button
        key={t}
        type="button"
        onClick={() => setSettings(current => current ? {
          ...current,
          assistant: { ...current.assistant, tone: t },
        } : current)}
        className={cn(
          'rounded-xl border px-4 py-2 text-sm transition',
          (settings.assistant.tone ?? 'informal') === t
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border/60 bg-background/60 text-muted-foreground hover:text-foreground',
        )}
      >
        {t === 'informal' ? 'Uformel' : 'Formel'}
      </button>
    ))}
  </div>
</div>

{/* Custom instructions */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    Egne instruktioner
  </label>
  <textarea
    rows={4}
    value={settings.assistant.customInstructions ?? ''}
    onChange={e => setSettings(current => current ? {
      ...current,
      assistant: { ...current.assistant, customInstructions: e.target.value },
    } : current)}
    placeholder="Eks: Kald altid børnene ved navn. Brug humor. Nævn altid hvem der har ansvaret."
    className="w-full rounded-2xl border border-border/60 bg-background/60 px-4 py-3 text-sm outline-none focus:border-primary/60 resize-none"
  />
  <p className="text-xs text-muted-foreground">
    Tilføjes til AI-assistentens systemprompt. Brug til at give assistenten personlighed eller husregler.
  </p>
</div>
```

- [ ] **Step 3: Ensure tone + customInstructions are included in handleSaveSettings**

Find `handleSaveSettings` (around line 713). The assistant block should already be included via `assistant: settings.assistant`. Verify it looks like:

```typescript
const next = await saveSettings({
  theme: settings.theme,
  mail: settings.mail,
  sync: settings.sync,
  assistant: settings.assistant,   // ← includes tone + customInstructions
  weather: settings.weather,
  language: settings.language,
});
```

If `assistant` is not in the list, add it.

- [ ] **Step 4: Typecheck frontend**

```bash
cd packages/frontend && npm run typecheck 2>&1 | head -10
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat: assistant settings — tone toggle + custom instructions textarea"
```

---

## Task 5: Deploy

- [ ] **Step 1: Push to GitHub**

```bash
git push
```

- [ ] **Step 2: Redeploy**

```bash
ssh mhouborg@192.168.1.252 "/home/mhouborg/redeploy-mentalload.sh 2>&1 | tail -10"
```

- [ ] **Step 3: Smoke test**

1. Open `mentalload.pl0k.online` → Settings → Assistant
2. Verify tone toggle (Uformel / Formel) and custom instructions textarea appear
3. Set tone to Uformel, enter custom instructions, click Save
4. Open the AI chat panel, type: `hvad spiser vi søndag?`
5. Expected: Ollama responds in Danish with the actual food plan for Sunday (or "ikke planlagt" if not set)
6. Type: `hvad sker der på mandag?`
7. Expected: Ollama responds with any Monday calendar entries

---

## Self-Review

**Spec coverage:**
- ✅ `tone` + `customInstructions` added to `AssistantConfig`: Task 1
- ✅ `buildSystemPrompt` assembles base prompt from family name, members, tone, language, custom instructions: Task 2
- ✅ Calendar snapshot (next 7 days, max 15 entries, Danish day names): Task 2
- ✅ Food plan snapshot (this week + next week, Danish day names): Task 2
- ✅ `getMondayStr` utility for week start calculation: Task 2
- ✅ `funChat` uses `/api/chat` when systemPrompt available, falls back to `/api/generate`: Task 2
- ✅ New callbacks wired in `getRequestServices`: Task 3
- ✅ Frontend tone toggle + custom instructions textarea in Settings: Task 4
- ✅ `handleSaveSettings` includes assistant fields: Task 4
- ✅ Deploy: Task 5

**Type consistency:**
- `listUpcomingEntries` callback: `(from: string, to: string) => Promise<Entry[]>` — matches `entryService.listOccurrences` signature in Task 3 ✅
- `getCurrentFoodPlan` callback: `(weekStart: string) => Promise<FoodPlanItem[]>` — matches `repo.foodPlanRepository.listByWeek` signature in Task 3 ✅
- `tryOllamaChat` third param `systemPrompt?: string` — used in Task 2 `funChat` call ✅
- `runtimeConfig` in `buildSystemPrompt` includes `tone` and `customInstructions` — returned by `getAssistantRuntimeConfig` in Task 3 ✅

**Edge cases:**
- `buildSystemPrompt` catches all errors and returns `undefined` — `funChat` falls back to `/api/generate` without system prompt ✅
- Empty `customInstructions` is trimmed before adding to prompt ✅
- `upcomingEntries.slice(0, 15)` prevents oversized prompts ✅
- `getMondayStr` handles Sunday (day=0) correctly with `day === 0 ? -6 : 1 - day` ✅
