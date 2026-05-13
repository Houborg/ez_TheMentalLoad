# Mobile UI/UX Redesign — Design Spec

**Date:** 2026-05-13
**Status:** Approved — ready for implementation planning

---

## Overview

Full mobile-first redesign of the MentalLoad frontend. The desktop layout (sidebar + main content) remains unchanged for `md:` and above. Below `md:` the entire shell is replaced by a purpose-built mobile experience modelled on Apple Calendar patterns.

No backend changes required. All work is frontend-only: new components, restyled existing logic, new routing wires.

---

## Section 1: Shell & Navigation

### Bottom nav — 4 tabs
`Kalender · Opgaver · Mad · Mere`

- Built in `MobileNav` (rewrite of existing component)
- Active tab: primary purple `#6d5efc` icon + label
- Inactive: muted foreground
- `···` Mere tab opens a **bottom sheet** (not a page) — see Section 7

### Floating + button
- Top-right corner on every main tab (Kalender, Opgaver, Mad)
- Purple, rounded, consistent position
- Triggers the AI quick-add flow (Section 3)

### No sidebar on mobile
- Existing `hidden md:flex` on the sidebar stays
- All navigation is bottom-tab only

---

## Section 2: Kalender tab (main screen)

The hero screen. Apple Calendar layout — month grid top, selected day's events below.

### Header bar
- Month name + year (left), `‹ ›` month navigation (right)
- Small search icon far-right (placeholder hook for future search feature)

### Month grid
- Full-width 7-column grid
- Day headers: M T O T F L S
- Today: filled purple circle
- Selected day: lighter purple ring
- Days with events: small coloured dot beneath the number (one per calendar colour, max 3)
- Past days: dimmed opacity
- Tap a day → selects it, updates event list below

### Day event list
- Header: selected date ("Onsdag 13. maj")
- Each event: coloured left border (calendar colour) · title bold · time + member name below
- Tasks: checkbox icon instead of time indicator
- Empty state: "Ingen begivenheder denne dag"

### Gestures
- Swipe left/right on grid → previous/next month
- Swipe up on day list → collapses grid to single current-week row (more list space)
- Swipe down on collapsed grid → expands back to full month

### New component: `MobileCalendarView`
Extracted from `dashboard-app.tsx`. Month grid logic already exists — needs mobile-first styling + collapse gesture.

---

## Section 3: Add event flow

Three-stage bottom sheet funnel.

### Stage 1 — AI quick-add (default, opens on `+`)
- Single large text input
- Placeholder: *"Hvad sker der? fx 'Tandlæge fredag kl 14 med Lars'"*
- On submit: posts to existing `/api/v1/assistant` endpoint
- Loading spinner while parsing
- On success → transitions to Stage 2 with fields pre-filled
- On failure → transitions to Stage 2 empty

### Stage 2 — Quick form (bottom sheet)
- Fields: title, date pill, time pill, member avatar row, calendar picker
- Link at bottom: *"Tilføj flere detaljer →"*
- Confirm button saves immediately via existing create entry API
- Covers ~90% of entries

### Stage 3 — Full form (full screen)
- Triggered by "Tilføj flere detaljer" or when entry has tasks / invitees / recurrence
- Pushes full screen with Cancel / Gem in top bar
- Existing desktop form restyled for mobile (proper input sizing, no horizontal scroll)

### New component: `MobileQuickAdd`
Self-contained bottom sheet owning all three stages. `EntryService` and assistant API untouched.

---

## Section 4: Event detail (bottom sheet)

Tapping any event card in the day list opens `MobileEventSheet`.

### Content
- Drag handle
- Coloured dot + title (large, bold)
- Detail rows with icons: 🕐 time range · 📍 location · 👤 member(s) · 🔔 reminder · 🔁 recurrence
- Inline task checklist if entry has tasks (checkboxes tappable from this sheet)
- Bottom: **Rediger** (primary, full-width) + 🗑️ delete icon (right)

### Behaviour
- Drag handle or tap-outside dismisses
- **Rediger** → closes sheet, pushes Stage 3 full form pre-filled
- 🗑️ → inline confirmation ("Slet begivenhed? Ja / Annuller") — no extra modal
- Recurring entries → Rediger shows picker: *"Kun denne · Denne og fremtidige · Alle"*

### New component: `MobileEventSheet`
Takes `Entry` prop. Reuses data logic from `entry-details-popup.tsx`, new mobile layout.

---

## Section 5: Opgaver tab

Cross-family task list, filterable by member.

### Structure
- **Filter strip** — member avatar chips (one per family member + Alle). Default: Alle.
- **Sections:** I dag · Denne uge · Kommende · Uden dato — collapsible, count in header
- **Each row:** Checkbox (left) · title · member avatar (right) · optional time label

### Behaviour
- Tap checkbox → marks done via existing API, optimistic update, 3s undo toast
- Tap title → opens `MobileEventSheet`
- `+` → opens `MobileQuickAdd` pre-set to Opgave type

### New component: `MobileTaskList`
Fetches `type: task` entries, groups, renders. Completion API extracted from `dashboard-app.tsx`.

---

## Section 6: Mad tab

Food planner, mobile-first.

### Structure
- **Week strip** — 7 day pills, current day highlighted. Swipe left/right to change week.
- **Day cards** — one per day: day name + date, meal title or *"Ingen plan"* (dimmed), `+` icon
- Tapping a card (or `+` on empty day) → simple bottom sheet: meal title input + save

### New component: `MobileFoodPlanner`
Week navigation + day cards. Existing food plan API calls extracted from `dashboard-app.tsx`.

---

## Section 7: Mere sheet

Tapping `···` slides up a compact bottom sheet — not a page.

### Content — 2×2 grid of large tappable tiles

| ⏱️ I dag | 👨‍👩‍👧 Familie |
|---|---|
| 🤖 Assistent | ⚙️ Indstillinger |

- **I dag** → `TodayTimelineBoard` full-screen, back button
- **Familie** → existing family members section, full-screen
- **Assistent** → AI chat full-screen (already built)
- **Indstillinger** → existing settings tabs, full-screen

Sheet dismisses on tap-outside or after navigating. No new backend work.

---

## New Components Summary

| Component | Purpose | Based on |
|---|---|---|
| `MobileNav` | Bottom nav bar (rewrite) | Existing `mobile-nav.tsx` |
| `MobileCalendarView` | Month grid + day event list | Extracted from `dashboard-app.tsx` |
| `MobileQuickAdd` | 3-stage add event sheet | New; uses existing assistant + entry APIs |
| `MobileEventSheet` | Event detail bottom sheet | Extracted from `entry-details-popup.tsx` |
| `MobileTaskList` | Opgaver tab task list | Extracted from `dashboard-app.tsx` |
| `MobileFoodPlanner` | Mad tab food planner | Extracted from `dashboard-app.tsx` |
| `MobileMoreSheet` | Mere ··· navigation sheet | New |

---

## What Is NOT Changing

- Desktop layout (`md:` and above) — untouched
- All backend services, APIs, repositories
- `TodayTimelineBoard` component internals
- Auth flow pages (login, signup, etc.)
- `dashboard-app.tsx` state management — components extract from it, not replace it

---

## Scope boundary

This spec covers the mobile shell and 4 primary tabs. The following are out of scope for this sprint:
- Search functionality
- National holidays import
- Push notification UI
- WebSocket reconnect on mobile
