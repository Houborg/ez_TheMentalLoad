# AI Context & Custom System Prompt — Design Spec

**Date:** 2026-05-12  
**Status:** Approved

---

## Overview

Two improvements to the AI assistant's `funChat` flow:

1. **Custom system prompt** — structured fields (tone, custom instructions) combined with live family data (name, members) to auto-generate a rich Danish system prompt per family. A free-text override field lets families add anything extra.
2. **Live data injection** — every `funChat` call includes a compact snapshot of the next 7 days' calendar events and the current + next week's food plan, so the AI can answer questions like *"hvad spiser vi søndag"* or *"lav en indkøbsliste til mandag"*.

The `parseRequest` flow (entry creation) is unaffected — this only improves the conversational chat.

---

## 1. Settings Schema Changes

**No new DB migration needed.** The `settings.assistant` object stored in `families.settings_json` gets two new optional fields:

```typescript
// packages/contracts/src/domain.ts — AssistantConfig additions
export interface AssistantConfig {
  id: string;
  modelName: string;
  language: SupportedLanguage;
  enabled: boolean;
  ollamaUrl?: string;
  // NEW
  tone?: 'informal' | 'formal';           // default: 'informal'
  customInstructions?: string;            // free-text, default: ''
}
```

`UpdateSettingsRequest.assistant` already accepts `Partial<AssistantConfig>` so no changes needed in `api.ts`.

---

## 2. AssistantService — new callbacks + prompt builder

**File:** `packages/backend/src/domains/assistant/assistant-service.ts`

### New constructor callbacks

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
    // NEW
    private readonly listUpcomingEntries?: (from: string, to: string) => Promise<Entry[]>,
    private readonly getCurrentFoodPlan?: (weekStart: string) => Promise<FoodPlanItem[]>,
    private readonly getFamilyName?: () => Promise<string | null>,
  ) {}
}
```

### System prompt builder

A new `buildSystemPrompt()` function assembles the prompt from live data:

```
Du er en hjælpsom familie-assistent for familien {familyName}.
Familiemedlemmer: {name} ({role}), ...
Svar på {language === 'da' ? 'dansk' : 'engelsk'}. Vær {tone === 'formal' ? 'formel' : 'uformel og venlig'}.
{customInstructions — only if non-empty}

Kommende begivenheder (næste 7 dage):
{events list — title, date, time, owner — or "Ingen kommende begivenheder"}

Madplan:
{food plan for this week + next week — day: dish — or "Ingen madplan denne uge"}
```

### Updated `funChat`

```typescript
async funChat(input: AssistantFunRequest): Promise<AssistantFunResponse> {
  const runtimeConfig = await this.getAssistantRuntimeConfig?.();
  const systemPrompt = await this.buildSystemPrompt(runtimeConfig);
  const ollamaResponse = await tryOllamaChat(input.message, runtimeConfig, systemPrompt);
  // ... fallback unchanged
}
```

`tryOllamaChat` gets a new optional `systemPrompt` parameter. When provided it uses the `/api/chat` endpoint (with `messages: [{role:'system',...},{role:'user',...}]`) instead of `/api/generate`.

**Fallback:** If `listUpcomingEntries` or `getCurrentFoodPlan` callbacks are missing or throw, those blocks are simply omitted from the prompt. Chat still works.

---

## 3. Wiring in app.ts

In `getRequestServices(familyId)`, update the `AssistantService` constructor call to pass the two new callbacks and the family name resolver:

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
  // NEW — upcoming entries (next 7 days)
  (from, to) => entryService.listOccurrences(from, to),
  // NEW — food plan (current week)
  (weekStart) => repo.foodPlanRepository.listByWeek(weekStart),
  // NEW — family name
  async () => {
    const result = await infrastructure.pool?.query<{ name: string | null }>(
      'select name from families where id = $1', [familyId]
    );
    return result?.rows[0]?.name ?? null;
  },
);
```

---

## 4. Frontend — Settings UI

**New section in Settings → Assistant tab** in `dashboard-app.tsx`:

### Tone
Two-button toggle: **Uformel** (default) / **Formel**  
Saves to `settings.assistant.tone`.

### Custom instructions
Textarea, ~4 rows.  
Placeholder: `Eks: Kald altid børnene ved navn. Brug humor. Nævn altid hvem der har ansvaret for opgaven.`  
Saves to `settings.assistant.customInstructions`.

Both fields are saved via the existing `handleSaveSettings()` flow — no new API route needed.

---

## 5. Ollama API change: generate → chat

`tryOllamaChat` switches from `/api/generate` (single prompt string) to `/api/chat` (messages array with roles) when a system prompt is available. This is the correct Ollama API for multi-turn / system-prompted conversations.

```typescript
// Before:
POST /api/generate
{ model, prompt: `You are... User: ${message}`, stream: false }

// After (when systemPrompt available):
POST /api/chat
{ model, stream: false, messages: [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: message }
]}
```

Response field changes from `response` to `message.content`.

`llama3.2:3b` fully supports `/api/chat` — no model change needed.

---

## 6. Data snapshot format details

**Calendar snapshot** — fetches `listOccurrences(now, now+7days)`, formats each entry as:
```
- {weekday} {dd/mm}: {title} kl. {HH:mm} ({ownerMemberName})
```
All-day events omit the time. Max 15 entries to keep prompt size reasonable.

**Food plan snapshot** — fetches current week + next week (2 calls), formats as:
```
Uge {n}: Mandag: {dish}, Tirsdag: {dish}, ...
Uge {n+1}: ...
```
Days with no dish show `(ikke planlagt)`.

**Week start calculation** — Monday of the current week in `YYYY-MM-DD` format, UTC. Next week = current Monday + 7 days. Both are passed as separate calls to `getCurrentFoodPlan`.

---

## 7. Out of Scope

- Conversation history / multi-turn memory (each `funChat` call is stateless)
- Custom AI provider (ChatGPT/Claude) — separate future feature
- The `parseRequest` (entry creation) flow — unchanged
