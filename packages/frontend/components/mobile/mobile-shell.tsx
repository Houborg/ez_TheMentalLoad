'use client';

import { useState } from 'react';
import type { AssistantDraft, Calendar, Entry, Member } from '@mental-load/contracts';
import { MobileNav, type MobileTab } from './mobile-nav';
import { MobileCalendarView } from './mobile-calendar-view';
import { MobileTaskList } from './mobile-task-list';
import { MobileFoodPlanner } from './mobile-food-planner';
import { MobileEventSheet } from './mobile-event-sheet';
import { MobileQuickAdd } from './mobile-quick-add';
import { MobileMoreSheet, type MoreSection } from './mobile-more-sheet';

type Props = {
  members: Member[];
  calendars: Calendar[];
  onRefresh: () => void;
  onNavigateDesktopSection: (section: string) => void;
};

export function MobileShell({ members, calendars, onRefresh, onNavigateDesktopSection }: Props) {
  const [activeTab, setActiveTab] = useState<MobileTab>('kalender');
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection | null>(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);

  function handleTabSelect(tab: MobileTab) {
    if (tab === 'mere') {
      setMoreOpen(true);
      return;
    }
    setActiveTab(tab);
  }

  function handleMoreNavigate(section: MoreSection) {
    setMoreSection(section);
    setMoreOpen(false);
  }

  function handleEntryCreated(_entry: Entry) {
    onRefresh();
    setQuickAddOpen(false);
    setCalendarRefreshKey(k => k + 1);
  }

  function handleEntryDeleted() {
    onRefresh();
    setSelectedEntry(null);
    setCalendarRefreshKey(k => k + 1);
  }

  // "Mere" sub-sections: full-screen overlays with a back button
  if (moreSection) {
    const sectionLabel =
      moreSection === 'idag'
        ? 'I dag'
        : moreSection === 'familie'
          ? 'Familie'
          : moreSection === 'assistent'
            ? 'Assistent'
            : 'Indstillinger';

    return (
      <div className="fixed inset-0 z-30 bg-background flex flex-col">
        {/* Back bar */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => setMoreSection(null)}
            className="text-sm text-primary"
          >
            ← Tilbage
          </button>
          <h1 className="font-semibold text-sm">{sectionLabel}</h1>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-auto">
          {moreSection === 'idag' ? (
            // TodayTimelineBoard requires timelinesByMemberId, onConfirmTask, etc. which are
            // not available in MobileShell's scope — showing a contextual placeholder instead.
            <div className="p-4 text-sm text-muted-foreground">
              I dag-visning (timeline)
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">
                Åbner{' '}
                {moreSection === 'familie'
                  ? 'Familie'
                  : moreSection === 'assistent'
                    ? 'Assistent'
                    : 'Indstillinger'}
                …
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      {/* Tab content area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'kalender' && (
          <MobileCalendarView
            members={members}
            calendars={calendars}
            onAddEntry={() => setQuickAddOpen(true)}
            onSelectEntry={setSelectedEntry}
            refreshKey={calendarRefreshKey}
          />
        )}
        {activeTab === 'opgaver' && (
          <MobileTaskList
            members={members}
            onAddTask={() => setQuickAddOpen(true)}
            onSelectEntry={setSelectedEntry}
          />
        )}
        {activeTab === 'mad' && <MobileFoodPlanner />}
      </div>

      {/* Bottom nav */}
      <MobileNav active={activeTab} onSelect={handleTabSelect} />

      {/* Sheets */}
      <MobileEventSheet
        entry={selectedEntry}
        members={members}
        calendars={calendars}
        onClose={() => setSelectedEntry(null)}
        onEdit={(_entry: Entry) => {
          setSelectedEntry(null);
          onNavigateDesktopSection('dashboard');
        }}
        onDeleted={handleEntryDeleted}
      />

      <MobileQuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        members={members}
        calendars={calendars}
        onCreated={handleEntryCreated}
        onOpenFull={(_draft?: Partial<AssistantDraft>) => {
          setQuickAddOpen(false);
          onNavigateDesktopSection('dashboard');
        }}
      />

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNavigate={handleMoreNavigate}
      />
    </div>
  );
}
