'use client';

import { useState } from 'react';
import type { Calendar, Entry, Member } from '@mental-load/contracts';
import { MobileNav, type MobileTab } from './mobile-nav';
import { MobileCalendarView } from './mobile-calendar-view';
import { MobileTaskList } from './mobile-task-list';
import { MobileFoodPlanner } from './mobile-food-planner';
import { MobileEventSheet } from './mobile-event-sheet';
import { MobileQuickAdd } from './mobile-quick-add';
import { MobileMoreSheet, type MoreSection } from './mobile-more-sheet';
import { MobileEntrySheet } from './mobile-entry-sheet';
import { MobileSettingsContent } from './mobile-settings-content';
import type { MobileEntryDraft } from './mobile-entry-draft';

type EntrySheetState =
  | { mode: 'create'; draft?: Partial<MobileEntryDraft> }
  | { mode: 'edit'; entry: Entry };

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
  const [quickAddType, setQuickAddType] = useState<'event' | 'task'>('event');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection | null>(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [entrySheet, setEntrySheet] = useState<EntrySheetState | null>(null);

  function handleTabSelect(tab: MobileTab) {
    if (tab === 'mere') {
      setMoreOpen(true);
      return;
    }
    setActiveTab(tab);
  }

  function handleMoreNavigate(section: MoreSection) {
    setMoreOpen(false);
    setMoreSection(section);
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

  function handleEditEntry(entry: Entry) {
    setSelectedEntry(null);
    setEntrySheet({ mode: 'edit', entry });
  }

  function handleEntrySaved(saved: Entry) {
    setEntrySheet(null);
    onRefresh();
    setCalendarRefreshKey(k => k + 1);

    // If we were editing, reopen the detail sheet with the freshly saved entry
    if (entrySheet?.mode === 'edit') {
      setSelectedEntry(saved);
    }
  }

  function handleOpenFull(draft?: Partial<MobileEntryDraft>) {
    setQuickAddOpen(false);
    setEntrySheet({ mode: 'create', draft });
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
          {moreSection === 'idag' && (
            <div className="p-4 text-sm text-muted-foreground">I dag-visning (timeline)</div>
          )}
          {moreSection === 'indstillinger' && (
            <MobileSettingsContent />
          )}
          {moreSection === 'familie' && (
            <div className="p-4 flex flex-col gap-3">
              {members.map(m => (
                <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-sm font-semibold flex-shrink-0">
                    {m.avatar || m.name[0]}
                  </div>
                  <div>
                    <div className="font-medium text-sm">{m.name}</div>
                    <div className="text-xs text-muted-foreground">{m.role === 'parent' ? 'Forælder' : 'Barn'}{m.email ? ` · ${m.email}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {moreSection === 'assistent' && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Brug chat-assistenten på startskærmen.</p>
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
            onAddEntry={(date) => setEntrySheet({ mode: 'create', draft: { type: 'event', startTime: date.toISOString() } })}
            onSelectEntry={setSelectedEntry}
            refreshKey={calendarRefreshKey}
          />
        )}
        {activeTab === 'opgaver' && (
          <MobileTaskList
            members={members}
            onAddTask={() => { setQuickAddType('task'); setQuickAddOpen(true); }}
            onSelectEntry={setSelectedEntry}
            refreshKey={calendarRefreshKey}
          />
        )}
        {activeTab === 'mad' && <MobileFoodPlanner />}
      </div>

      {/* Bottom nav */}
      <MobileNav active={activeTab} onSelect={handleTabSelect} />

      {/* Event detail sheet */}
      <MobileEventSheet
        entry={selectedEntry}
        members={members}
        calendars={calendars}
        onClose={() => setSelectedEntry(null)}
        onEdit={handleEditEntry}
        onDeleted={handleEntryDeleted}
      />

      {/* Full entry form sheet (create + edit) */}
      <MobileEntrySheet
        open={entrySheet !== null}
        mode={entrySheet?.mode ?? 'create'}
        entry={entrySheet?.mode === 'edit' ? entrySheet.entry : undefined}
        initialDraft={entrySheet?.mode === 'create' ? entrySheet.draft : undefined}
        members={members}
        calendars={calendars}
        onClose={() => setEntrySheet(null)}
        onSaved={handleEntrySaved}
      />

      {/* Quick-add sheet */}
      <MobileQuickAdd
        open={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        members={members}
        calendars={calendars}
        onCreated={handleEntryCreated}
        defaultType={quickAddType}
        onOpenFull={handleOpenFull}
      />

      <MobileMoreSheet
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        onNavigate={handleMoreNavigate}
      />
    </div>
  );
}
