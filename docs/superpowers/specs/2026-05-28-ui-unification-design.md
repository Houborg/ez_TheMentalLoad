# UI Unification — Design Spec

**Date:** 2026-05-28  
**Status:** Approved  
**Scope:** All 5 desktop views + shared shell + UI consistency fixes

---

## 1. Goal

Every view must share the same visual shell, colour tokens, card style, and spacing. The Dashboard (Hjem) sets the reference. The light theme used in the mockups is the canonical theme — warm off-white background, white cards, subtle borders and shadows.

---

## 2. Design Tokens (canonical)

These must be applied consistently across every view. No hardcoded colours in components.

```css
/* Backgrounds */
--page-bg:     #f0f0ec;   /* warm off-white page background */
--card-bg:     #ffffff;
--card-border: #e8e8e8;
--card-shadow: 0 3px 16px rgba(0,0,0,0.07);
--card-radius: 10px;       /* cards */
--shell-radius: 14px;      /* outer shell */

/* Accent */
--primary: #4f8ef7;
--primary-light: #eef3ff;

/* Text */
--text-primary:   #1a1a2e;
--text-secondary: #666;
--text-muted:     #aaa;
--text-faint:     #bbb;

/* Borders */
--border-subtle: #f0f0f0;
--border-card:   #e8e8e8;
--border-week:   #f5f5f5;   /* calendar week row dividers */

/* Section labels */
--label-size: 9px;
--label-weight: 700;
--label-color: #aaa;
--label-transform: uppercase;
--label-spacing: 0.5px;
```

Member palette (existing — keep as-is):
```
#6d5efc  #ef4444  #22c55e  #f59e0b  #3b82f6  #8b5cf6  #ec4899  #f97316  #14b8a6  #6366f1
```

---

## 3. Shared Shell

Every view (Hjem, I dag, Planner, Familie, Indstillinger) is wrapped in:

```
┌─────────────────────────────────┐
│  SlimHeader (sticky, white)     │
│  avatar · title · date · 🤖 ＋  │
├─────────────────────────────────┤
│  View content (var(--page-bg))  │
│  padding: 10px                  │
│  gap: 8px between sections      │
├─────────────────────────────────┤
│  BottomNav (sticky, white)      │
│  🏠 Hjem · ⏰ I dag · 📋 Planner│
│  · 👨‍👩‍👧 Familie · ⚙️ Indstil.  │
└─────────────────────────────────┘
```

**SlimHeader:**
- White background, `border-bottom: 1px solid var(--border-subtle)`
- Left: family avatar (32×32, member primary colour), app title, today's date
- Right: 🤖 AI button (29×29, rounded-8, bg `#f0f0f0`), ＋ add button
- AI assistant lives **only** here — removed from all view content areas

**BottomNav:**
- White background, `border-top: 1px solid var(--border-subtle)`
- 5 items: icon + label, active item gets `background: var(--primary-light)`, label in `--primary`

---

## 4. View Specs

### 4.1 Hjem (Dashboard)

Sections rendered top-to-bottom, all scrollable:

#### Weather strip
- White card, `border-radius: 10px`, `border: 1px solid var(--border-card)`
- 7 day columns, **`border-right: 1px solid #f0f0f0`** between each day (subtle separator)
- Today column: `background: var(--primary-light)`, border-radius inside
- Each column: day name (9px, bold, muted) · weather emoji · high temp (10px, bold) · low temp (8px, faint)

#### Stat cards
- 2×2 grid, white cards, unchanged from current
- Icon · big number · label

#### Calendar
- White card, full-size day cells, **matches current app style exactly**
- Column headers: MAN TIR ONS TOR FRE LØR SØN
- Day number: top-left of cell (20×20, circle). Today = dark circle (`background: #1a1a2e; color: #fff`)
- Event count badge: top-right of cell (9px, faint)
- **Event pills:**
  - Single member: solid rounded pill in member colour, title truncated with `…`
  - Two members: `background: linear-gradient(90deg, color1 50%, color2 50%)`
  - Three or four members: gradient split equally across member colours
  - Overflow: `+N mere` in muted text below pills
- **Multi-day spanning events:**
  - First day: `border-radius: 20px 0 0 20px` (pill cap on left)
  - Middle days: `border-radius: 0` (flat bar, slightly lower opacity)
  - Last day: `border-radius: 0 20px 20px 0` (pill cap on right)
  - Implemented via absolute positioning within each week row, with `left` and `width` set as fractions of 7 columns
- Clicking a day selects it and updates the Dagsorden below

#### Dagsorden (selected day)
- White card
- Member avatar columns: one column per family member
- Column header: avatar (24×24) + member name (8px, bold, muted)
- Column body: coloured event pills stacked vertically with time
- Empty column: "Ingen" in faint text

#### Opgavefremskridt
- Horizontal strip, one card per member
- Avatar (28×28) · progress bar (4px, member colour) · `X/Y` count
- Unchanged from current

#### Kommende begivenheder
- White card, list rows
- Each row: 4px coloured left bar (member colour) · date column (day num + day name) · event title + member dots row
- Multi-member events: stack of small 6×6 member dots + names

#### Invitationer (pending only)
- Amber-tinted card (`background: #fffbeb; border: 1px solid #fde68a`)
- Each invite: emoji · event name + sender + time · Ja / Nej buttons
- Only shown when there are pending invitations

#### AI Assistant
- **Removed from Hjem.** Lives exclusively in the SlimHeader 🤖 button.

---

### 4.2 I dag

Replaces the old "Planner" (kiosk full-screen). Same shell.

#### View toggle
- Small toggle pill: "I dag" | "Uge" — switches between today's hourly grid and 7-day week grid

#### Member column headers
- Centered above each grid column: avatar (36×36, member colour, box-shadow) + member name (9px, bold)
- Separated from grid by a `border-bottom: 2px solid var(--border-card)`

#### Time grid (I dag mode)
- Time labels: 28px gutter on left, 9px, right-aligned, muted
- Each member gets a column
- Events: coloured rounded blocks with title and time

#### Week grid (Uge mode)
- 7-day columns with day header (dow + date number)
- Today column highlighted
- Member events as coloured pills per day per column
- Prev/next week navigation in SlimHeader when in Uge mode

#### Meal strip (pinned at bottom of content)
- Section label: "🍽 Madplan denne uge"
- 5 cards (Mon–Fri), each:
  - Day name (8px, bold, muted)
  - Food emoji (18px)
  - Meal name (8px, bold)
  - Today's card: `border: 1px solid var(--primary); background: var(--primary-light)`
  - **Interactive:** tap → bottom sheet with full recipe steps (numbered) + grocery list
  - Grocery list items shown with 🛒 icon

---

### 4.3 Planner (AI availability finder)

Answers the question: "Can we do X on Monday?"

#### AI input bar
- White card, `border: 1.5px solid var(--primary)`, subtle shadow
- 🤖 icon + text input + send arrow
- Placeholder: "Hvornår kan vi…"

#### Quick chips
- Scrollable horizontal row of suggestion chips
- Examples: "Hvornår er alle fri?", "Ledigt mandag?", "Planlæg middagstur", "Find 2 timer med Far + Mor"

#### AI answer card
- White card with question shown at top
- Natural language answer paragraph
- **Free slot cards** (ranked by quality):
  - 🎉 / ☀️ emoji · day + time window · who is free · "Bedst" / "Ok" badge
  - ＋ button to create an event in that slot directly
- Confident tone: "Ja! Fredag er perfekt. Alle fire er ledige…"

#### Week availability overview (below answer)
- 7-day compact grid showing each member's busy/free blocks
- Free windows highlighted in green (`#e6f4ea`)
- "🎉 Alle fri!" banner on days where everyone is free

#### Meal strip
- Same as I dag — pinned at bottom

---

### 4.4 Familie

#### Member cards (expandable)
- One card per family member, stacked vertically
- **Collapsed state:**
  - Avatar (44×44) with presence dot (bottom-right, 11×11): green=tilstede, amber=away, purple=school, grey=offline
  - Name (14px, bold) + role (10px, muted) + status pill (coloured badge: "🟢 Tilstede", "🟡 Arbejde", "🟣 I skole")
  - Task progress bar (right side): thin bar in member colour + `X/Y` count
  - Chevron ▾ to expand
- **Expanded state:**
  - Next upcoming event (small row with colour dot + title + time)
  - Task list section label
  - Each task: circular check (done = green filled ✓, pending = grey ring) · title · time · optional reward emoji (🍦 ⭐ 🍪)
  - Completed tasks: title struck through + muted
  - Motivational hint when nearly done: "🎉 Næsten i mål! X opgave tilbage"
- **Task sources:** event checklists, standalone tasks, recurring reminders (vitamins, medicine, routines)
- **Both parents and children** have task lists
- Tap expanded header → navigate to full `/member/[id]` page

#### Add member button
- Dashed border card at bottom: `＋ Tilføj familiemedlem`

---

### 4.5 Indstillinger

- Same visual language as all other views — white cards, `--card-radius`, `--card-border`
- Tab bar uses primary pill style for active tab (same as mobile already does)
- No content changes — visual polish only

---

## 5. UI Consistency Fixes (bundled)

These are code-level fixes applied alongside the view redesigns:

| Fix | Location |
|---|---|
| Remove hardcoded `bg-[#0f0f1a]`, `border-white/10`, `text-white` | `kiosk-planner.tsx`, `kiosk-top-bar.tsx`, `time-grid.tsx`, `week-grid.tsx` |
| Replace with CSS token equivalents | Same files |
| Delete dead `AppSidebar` component | `app-sidebar.tsx` |
| Unify member colour system | Use `memberColorById` map everywhere; remove `MEMBER_COLOR_CLASSES` from sidebar |
| Deduplicate weather widget | Extract shared `<WeatherStrip>` component used by both Hjem and I dag |
| Fix confetti colours | `today-timeline-board.tsx` → use `--chart-1` through `--chart-5` tokens |
| Unify button icon style | All icon buttons: 29×29, `border-radius: 8px`, `background: #f0f0f0` |

---

## 6. Theme switch — dark mode → light mode default

The app currently forces dark mode via `class="dark"` on `<html>` in `app/layout.tsx`. This must be removed.

**Changes required:**
- `app/layout.tsx`: remove `className="dark"` from `<html>` (or make it conditional on Settings → Tema)
- `app/globals.css`: update the `:root` (light mode) CSS variables to match the design tokens in §2 above — the warm off-white palette, not the existing high-contrast light defaults
- Dark mode (`:root.dark`) remains available as a user preference via Settings → Tema — just no longer forced
- The `ThemeMode` toggle in Settings already supports `'system' | 'light' | 'dark'` — default should be `'light'`

---

## 7. What is NOT changing

- Mobile shell (`MobileShell`, `MobileNav`) — separate concern, out of scope
- Backend, API, contracts — no changes
- Settings content/tabs — only visual polish
- Authentication pages — out of scope
- Kiosk full-screen mode is **removed** as the default; the Planner tab replaces it

---

## 7. Open questions (deferred)

- Should the Planner AI use the existing Ollama assistant or a new dedicated endpoint?
- Planner week availability grid: should it be built as a separate component or reuse WeekGrid?
- Indstillinger tab consolidation (9 tabs is a lot) — separate design session

---

## 8. Mockup files

Session: `.superpowers/brainstorm/5085-1779949146/content/`

| File | Shows |
|---|---|
| `planner-refined.html` | I dag — time grid with avatars + meal strip |
| `planner-ai.html` | Planner — AI availability concept |
| `familie-view.html` | Familie — expandable member cards |
| `hjem-calendar-v2.html` | Hjem — full calendar with spanning pills |
| `hjem-refined.html` | Hjem — full page layout |
| `design-summary.html` | All views summary |
