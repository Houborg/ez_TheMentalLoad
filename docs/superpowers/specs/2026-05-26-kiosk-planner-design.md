# Kiosk Planner & Global Layout Redesign

**Date:** 2026-05-26  
**Status:** Approved — ready for implementation planning  
**Scope:** Global header, global navigation, Planner view, Food plan layout

---

## Overview

The app gets a unified layout overhaul centered on a "kiosk mode" Planner that shows today at a glance. The left sidebar is removed everywhere. Navigation moves to a bottom bar. The top header is stripped to just the essentials. The Planner view becomes a full-screen dashboard.

---

## 1. Global Header (all views)

Replaces the existing `<header>` in `dashboard-app.tsx` across every view.

**Contains (left → right):**
- Live clock (updates every second, e.g. `10:47`)
- Date label (e.g. `Man 26 maj`)
- Weather pill (icon + temp, e.g. `⛅ 18°C`) — only shown when weather is configured
- Spacer
- `✨ AI` button — opens the existing assistant panel
- `+ Tilføj` button — opens the existing entry composer

**Removed entirely:** search bar, member filter dropdown, refresh button, active-member picker, notifications bell.

---

## 2. Global Navigation — Bottom Nav Bar (all views except Planner)

Replaces the left sidebar (`<aside>`) in `dashboard-app.tsx`.

**Items (5):** Dashboard · Planner · Timeline · Familie · Indstillinger  
**Layout:** Full-width bar pinned to the bottom of the viewport. Icon + label per item, active item highlighted.  
**Planner item:** Clicking it enters full-screen kiosk mode (sidebar/nav hidden — see section 3).  
**All other items:** Switch view as today, bottom nav always visible.

The existing sidebar component, collapse state, and `isSidebarCollapsed` logic are removed.

---

## 3. Planner View — Full-Screen Kiosk

When the user navigates to Planner, the bottom nav and slim header are hidden. The kiosk owns the full viewport.

### 3a. Kiosk Top Bar

Single horizontal bar at the top of the kiosk:

| Element | Detail |
|---------|--------|
| Live clock | Large, bold — updates every second |
| Date | Subdued, next to clock |
| Weather pill | Icon + temp + condition text |
| Spacer | |
| Today / Uge toggle | Pill switch — controls the view below |
| `✨ AI` button | Opens assistant |
| `+ Tilføj` button | Opens entry composer |
| `☰` menu button | Returns to the last non-Planner view (exits kiosk) |

### 3b. Member Avatar Row

A row of avatar + name chips, **centered over their respective time-grid columns**. Achieved by mirroring the grid layout: a fixed-width offset (matching the time label column) followed by a CSS grid with the same column count as the member grid below.

### 3c. Time Grid — Today View (default)

Full-height scrollable time grid, one column per member.

- **Time axis:** Left column showing hour labels (e.g. 8, 9, 10…). Range: 6 AM – 11 PM (configurable later).
- **Member columns:** One column per member. Each entry renders as a colored block at its actual time position, sized by duration. Color matches member color.
- **"Now" line:** Red horizontal rule spanning all columns at the current time, with a dot on the left edge. Auto-scrolls to center the now-line in the viewport on mount.
- **Horizontal grid lines:** Subtle lines at each hour.

### 3d. Week View (toggle)

Same member column layout as today view — member avatars centered above their columns. The axis switches from hours to **days**:

- **Rows:** One row per day (Mon → Sun), each showing day name + date number + weather icon (from the forecast API) stacked in a fixed-width left column.
- **Columns:** One per member, matching the today time-grid layout exactly.
- **Cells:** Events for that member on that day rendered as compact colored chips (background = member color at ~80% opacity, time + truncated title inside).
- **Today row:** Highlighted with a subtle indigo tint; date number shown in a filled indigo circle.
- Empty cells are left blank — no placeholder text needed.

### 3e. Bottom Split Panel (Today view only)

Two panels side by side, below the time grid:

**Left — Today's Meal (`🍽 Aftensmad i dag`):**  
- Dish name (bold)  
- Grocery list items (subdued, comma-separated or dotted)  
- If no meal planned: a soft empty state  

**Right — Today's Tasks (`✅ Opgaver i dag`):**  
- One row per member: avatar + name + their checklist items for today  
- Each item shown as a row with ○ (incomplete) or ✓ (complete, struck through)  
- Sourced from today's timeline tasks (existing `loadTodayTimeline` API)

---

## 4. Food Plan — Horizontal 7-Day Strip

Shown below the main kiosk content in both today and week views — below the bottom split panel in today view, below the agenda list in week view. Replaces the current vertical day-by-day list.

**Layout:** 7 equal-width day cards in a single row (`grid-template-columns: repeat(7, 1fr)`).  
**Each card:** Day abbreviation (Mon, Tue…) + dish name. Today's card is visually highlighted.  
**Empty days:** Dashed border, `—` placeholder. Clickable to add a meal.  
**Existing edit/delete actions** preserved — clicking a filled card opens the composer.

---

## 5. What Gets Removed

| Current element | Disposition |
|----------------|-------------|
| Left `<aside>` sidebar | Removed |
| `isSidebarCollapsed` state + toggle button | Removed |
| Header search bar | Removed |
| Header member filter dropdown | Removed |
| Header refresh button | Removed |
| Header active-member picker | Removed |
| Header notifications bell | Removed |
| `app-sidebar.tsx` component | **Keep** — used by `app/member/[memberId]/page.tsx`, not the main dashboard |

---

## 6. Files Affected

| File | Change |
|------|--------|
| `dashboard-app.tsx` | Replace `<aside>` + `<header>` with new slim header + bottom nav; wrap Planner in full-screen kiosk shell |
| `components/planner-view.tsx` | Full redesign into kiosk layout (or replace with new `kiosk-planner.tsx`) |
| `components/agenda-view.tsx` | Reused for week-view list in kiosk |
| New: `components/kiosk-top-bar.tsx` | Kiosk header with clock, weather, toggle, controls |
| New: `components/bottom-nav.tsx` | Global bottom navigation bar |
| New: `components/time-grid.tsx` | Today time-grid with now-line |

---

## 7. Data Sources (existing APIs)

| Panel | API call |
|-------|----------|
| Time-grid events | `loadUpcomingOccurrences(1)` filtered to today, or `loadMonthOccurrences` |
| Today's tasks | `loadTodayTimeline(memberId)` per member |
| Today's meal | `loadFoodPlan(getWeekStart())` filtered to today's day |
| Weather pill | `loadWeatherForecast(...)` (already in PlannerView) |
| Week agenda | `loadUpcomingOccurrences(7)` (already in PlannerView) |

No new backend endpoints needed.
