# Mobile Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the full dashboard usable on mobile with a fixed bottom nav bar, responsive layouts, and touch-friendly interactions. Full feature parity — no features removed on mobile.

**Architecture:** Single responsive codebase. Tailwind `md:` prefix = desktop layout; default = mobile. Bottom nav bar replaces the sidebar on small screens. The existing `AppSidebar` stays for desktop. The large `dashboard-app.tsx` gets mobile-specific layout classes added to its key layout containers.

**Tech Stack:** Tailwind v4 (already installed), lucide-react (already installed), Next.js App Router.

---

## File Map

**Create:**
- `packages/frontend/components/mobile-nav.tsx` — fixed bottom nav for small screens

**Modify:**
- `packages/frontend/app/layout.tsx` — add viewport meta tag for mobile
- `packages/frontend/components/dashboard-app.tsx` — add mobile layout classes + integrate MobileNav
- `packages/frontend/components/app-sidebar.tsx` — hide on mobile (`hidden md:flex`)

---

## Task 1: Viewport meta + mobile layout shell

**Files:**
- Modify: `packages/frontend/app/layout.tsx`

- [ ] **Step 1: Add viewport meta and mobile-safe body class**

```typescript
// packages/frontend/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MentalLoad Dashboard',
  description: 'Family planning dashboard powered by the MentalLoad backend.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body className="overscroll-none">{children}</body>
    </html>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/app/layout.tsx
git commit -m "feat: add viewport meta and overscroll-none for mobile"
```

---

## Task 2: Mobile bottom nav component

**Files:**
- Create: `packages/frontend/components/mobile-nav.tsx`

- [ ] **Step 1: Create the component**

```typescript
// packages/frontend/components/mobile-nav.tsx
'use client';

import Link from 'next/link';
import { CalendarDays, CheckCircle2, Clock3, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavSection = 'dashboard' | 'planner' | 'timeline' | 'family' | 'settings';

type MobileNavProps = {
  activeSection: NavSection;
};

const NAV_ITEMS: Array<{ label: string; icon: typeof CalendarDays; key: NavSection; href: string }> = [
  { label: 'Home', icon: CalendarDays, key: 'dashboard', href: '/' },
  { label: 'Planner', icon: Clock3, key: 'planner', href: '/planner' },
  { label: 'Timeline', icon: CheckCircle2, key: 'timeline', href: '/?section=timeline' },
  { label: 'Family', icon: Users, key: 'family', href: '/?section=family' },
  { label: 'Settings', icon: Settings, key: 'settings', href: '/?section=settings' },
];

export function MobileNav({ activeSection }: MobileNavProps) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex border-t border-sidebar-border bg-sidebar/95 backdrop-blur pb-safe md:hidden"
      aria-label="Mobile navigation"
    >
      {NAV_ITEMS.map(item => (
        <Link
          key={item.key}
          href={item.href}
          className={cn(
            'flex flex-1 flex-col items-center justify-center gap-1 py-3 text-[10px] font-medium transition-colors min-h-[56px]',
            activeSection === item.key
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
          aria-label={item.label}
          aria-current={activeSection === item.key ? 'page' : undefined}
        >
          <item.icon className={cn('h-5 w-5', activeSection === item.key && 'text-primary')} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Add safe-area inset utility to globals.css if not present**

In `packages/frontend/app/globals.css`, ensure there's a CSS utility for `pb-safe` (bottom safe area for iPhone notch). Add if missing:

```css
@layer utilities {
  .pb-safe {
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/components/mobile-nav.tsx packages/frontend/app/globals.css
git commit -m "feat: mobile bottom nav bar component"
```

---

## Task 3: Hide sidebar on mobile, add bottom nav to dashboard

**Files:**
- Modify: `packages/frontend/components/app-sidebar.tsx`
- Modify: `packages/frontend/components/dashboard-app.tsx`

- [ ] **Step 1: Hide AppSidebar on mobile**

In `packages/frontend/components/app-sidebar.tsx`, find the root `<aside>` element and add `hidden md:flex` to its className (it already uses `flex`):

Change:
```typescript
className={cn(
  'flex shrink-0 border-r border-sidebar-border bg-sidebar/80 py-5 backdrop-blur transition-all duration-300 flex-col',
  ...
)}
```

To:
```typescript
className={cn(
  'hidden md:flex shrink-0 border-r border-sidebar-border bg-sidebar/80 py-5 backdrop-blur transition-all duration-300 flex-col',
  ...
)}
```

- [ ] **Step 2: Find the top-level layout container in dashboard-app.tsx**

Read the first 150 lines of `packages/frontend/components/dashboard-app.tsx` to locate the root layout div (the one that wraps AppSidebar and the main content area side by side).

- [ ] **Step 3: Add bottom padding on mobile to main content area**

The main content area needs `pb-16 md:pb-0` (or `pb-20`) so content isn't hidden behind the fixed bottom nav. Find the main content scroll container in `dashboard-app.tsx` and add this class.

- [ ] **Step 4: Import and render MobileNav in dashboard-app.tsx**

At the top of `dashboard-app.tsx`:
```typescript
import { MobileNav } from '@/components/mobile-nav';
```

Inside the component's return, alongside the AppSidebar, add:
```tsx
<MobileNav activeSection={activeSection} />
```

The `activeSection` state already exists in `dashboard-app.tsx` (used by AppSidebar). Reuse it directly.

- [ ] **Step 5: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/components/app-sidebar.tsx packages/frontend/components/dashboard-app.tsx
git commit -m "feat: integrate mobile bottom nav, hide sidebar on small screens"
```

---

## Task 4: Responsive layout classes in dashboard-app.tsx

**Files:**
- Modify: `packages/frontend/components/dashboard-app.tsx`

These are targeted Tailwind class additions. Read the relevant sections as you go.

- [ ] **Step 1: Header / action bars**

Find any `flex items-center justify-between` header rows that contain titles + action buttons. Add `flex-wrap gap-2` so they wrap on small screens instead of overflowing.

Example: `className="flex items-center justify-between"` → `className="flex flex-wrap items-center justify-between gap-2"`

- [ ] **Step 2: Grid layouts → single column on mobile**

Find any `grid grid-cols-N` or `grid-cols-2` / `grid-cols-3` layouts used for member cards, calendar items, or stat cards. Prefix them with mobile-first single column:

`grid-cols-2` → `grid-cols-1 sm:grid-cols-2`
`grid-cols-3` → `grid-cols-1 sm:grid-cols-2 md:grid-cols-3`

- [ ] **Step 3: Side-by-side form fields → stack on mobile**

Find any `flex gap-4` or `grid grid-cols-2` used in forms (create entry, create member). Change to `flex flex-col md:flex-row gap-4` or `grid grid-cols-1 md:grid-cols-2`.

- [ ] **Step 4: Modals / panels → full screen on mobile**

Find the main entry creation modal / side panel. On mobile it should be full-screen. Look for `fixed inset-0` or `max-w-lg` modal containers.

If the panel uses `max-w-lg` or similar: add `w-full md:max-w-lg` and ensure it's positioned correctly on mobile (`inset-0 md:inset-auto`).

- [ ] **Step 5: Calendar month view scroll**

The calendar month grid is wide. Add `overflow-x-auto` to the calendar month container so it scrolls horizontally on mobile rather than overflowing the viewport.

- [ ] **Step 6: Minimum touch target sizes**

Scan for small icon buttons (trash, edit, chevrons) inside lists. Where the button has `p-1` or `p-0.5`, increase to `p-2` on mobile: `p-1 md:p-1` → `p-2 md:p-1`. Or add `min-w-[44px] min-h-[44px]` to ensure 44px touch targets.

- [ ] **Step 7: Typecheck**

```bash
cd packages/frontend && npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/frontend/components/dashboard-app.tsx
git commit -m "feat: responsive layout — mobile-first grid, stacked forms, touch targets"
```
