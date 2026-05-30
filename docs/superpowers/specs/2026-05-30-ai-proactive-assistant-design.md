# AI Proactive Assistant — Design Spec

**Date:** 2026-05-30  
**Status:** Approved

---

## Goal

Transform the family assistant from a passive chat tool into a proactive co-planner that sees all family data, learns about the family over time, generates contextual suggestions automatically, and can execute actions with parent confirmation.

---

## Data Model

### `ai_suggestions` table
```sql
id           uuid primary key
family_id    uuid references families(id) on delete cascade
trigger_type text  -- 'morning' | 'event' | 'sync' | 'manual'
trigger_ref  text  -- entity id that caused the trigger (nullable)
category     text  -- 'task' | 'food' | 'calendar' | 'grocery' | 'info'
text         text  -- suggestion shown to user (in Danish)
action_type  text  -- 'add_event' | 'add_task' | 'update_food' | 'add_grocery' | 'set_reminder' | 'info'
action_data  jsonb -- pre-filled params for the action
status       text  -- 'pending' | 'confirmed' | 'executing' | 'done' | 'dismissed' | 'expired'
created_at   timestamptz default now()
expires_at   timestamptz -- 7 days auto-expire
```

### `ai_memory` table
```sql
id         uuid primary key
family_id  uuid references families(id) on delete cascade
category   text  -- 'person' | 'preference' | 'pattern' | 'event'
member_id  uuid references members(id) on delete cascade nullable
key        text  -- e.g. 'Emil birthday', 'prefers no fish'
value      text  -- e.g. 'June 15', 'true'
source     text  -- 'sync' | 'event' | 'chat' | 'ai' | 'user'
created_at timestamptz default now()
updated_at timestamptz default now()
```

---

## Architecture

### Backend

**AI Context Service** (`src/domains/assistant/ai-context-service.ts`)  
Assembles a complete markdown snapshot of family data: members + memory facts, events (60 days), food plan (2 weeks), tasks, Aula lessons, member schedules. Injected into every AI prompt.

**AI Repositories**  
- `ai-memory-repository.ts` — interface + InMemory + Postgres implementations  
- `ai-suggestion-repository.ts` — interface + InMemory + Postgres implementations

**Proactive Analysis Service** (`src/domains/assistant/proactive-analysis-service.ts`)  
Calls Claude with a two-tool prompt (`save_memory`, `create_suggestion`). Runs from the AI worker. Cannot execute actions — only proposes. Returns list of new suggestion IDs.

**Tool Executor** (`src/domains/assistant/tool-executor.ts`)  
Executes confirmed actions. Tools: `add_event`, `add_task`, `update_food_plan`, `add_grocery`, `set_reminder`. Called only after parent confirms in the UI.

**AI Worker** (`src/workers/ai-worker.ts`)  
BullMQ worker processing two job types:
- `proactive-analysis` — full family scan, triggered at 07:00 daily + after each sync
- `entity-trigger` — fired when specific entry/food item created/updated, rate-limited to once per entity per 10 minutes

**New API Routes**
- `GET /api/v1/ai/suggestions` — list pending suggestions
- `DELETE /api/v1/ai/suggestions/:id` — dismiss
- `POST /api/v1/ai/suggestions/:id/confirm` — mark as confirmed
- `POST /api/v1/ai/suggestions/:id/execute` — execute confirmed action
- `GET /api/v1/ai/memory` — list memories (grouped by member)
- `POST /api/v1/ai/memory` — add manual memory
- `DELETE /api/v1/ai/memory/:id` — delete memory
- `POST /api/v1/ai/analyze` — manual trigger for proactive analysis
- `POST /api/v1/ai/chat` — streaming chat with full tool set

### AI Prompting Strategy

**Proactive analysis prompt:**
```
Du er familieassistent for [FamilyName].

FAMILIEMEDLEMMER: [list with roles + key facts from ai_memory]
BEGIVENHEDER (næste 60 dage): [list]
MADPLAN (2 uger): [list]
OPGAVER: [list]
AULA: [lessons + presence]
HVAD SKETE NETOP NU: [trigger context]

Analyser familiedata og:
1. Brug save_memory() til at notere 1-3 nye facts du lærte
2. Brug create_suggestion() til at foreslå 2-5 nyttige handlinger

Forslag skal være konkrete og handlingsrettede. Skriv på dansk.
```

**Chat prompt:** Full context + full tool set. Every action tool call requires parent confirmation before execution.

---

## Frontend

### New Components
- `components/ai-tab.tsx` — AI tab (suggestions feed toggle / knowledge map toggle + chat input)
- `components/ai-knowledge-map.tsx` — visual family brain map (bubbles per member, fact chips)
- `components/ai-suggestion-card.tsx` — chip-style suggestion card with accept/dismiss
- `components/ai-confirmation-sheet.tsx` — bottom sheet showing exactly what AI will do

### Modified Components
- `dashboard-app.tsx` — add AI tab to bottom nav
- `familie-view.tsx` — add 2–3 key fact chips per member card
- `entry-details-popup.tsx` — inline AI chip for relevant suggestions
- `idag-view.tsx` — inline chip on empty food plan days
- `mobile-settings-content.tsx` — add AI knowledge editor tab

### UI Flow
1. Suggestion appears in AI tab feed (grouped: I dag / Denne uge / Næste uge)
2. Inline chips also appear contextually on events and food plan
3. User taps "Tilføj" → confirmation sheet slides up showing exact action
4. User taps "Ja, tilføj" → `/api/v1/ai/suggestions/:id/execute` → action created
5. Card shows ✅ Done animation

### Knowledge Map
- Toggle from suggestion feed to "Familiehjernen"
- Family name in center, member bubbles around it
- Each bubble expands to show fact categories and individual facts
- `🤖` = AI-learned, `✏️` = user-added
- `+` button per member to add manual facts

---

## Rate Limiting & Cost Control
- Max 1 entity-trigger per entity per 10 minutes
- Max 3 proactive analysis runs per day (morning + 2 sync-triggered)
- Suggestion expiry: 7 days
- Max 50 active suggestions at once (oldest dismissed first)

---

## Member Card Summary (Familie View)
Small fact chips under each member name: `🐟 Ingen fisk` `🩰 Ballet ons` `🎂 15 jun`
Tap opens full Familiehjernen filtered to that member.

---

## Settings → AI
Table view of all memories grouped by member. Add/edit/delete. Toggle proactive analysis on/off. Set morning analysis time (default 07:00).
