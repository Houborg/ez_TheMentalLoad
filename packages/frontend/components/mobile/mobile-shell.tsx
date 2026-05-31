'use client';

import { useState } from 'react';
import type { AulaPresence, Calendar, Entry, Member } from '@mental-load/contracts';
import { MobileNav, type MobileTab } from './mobile-nav';
import { MobileCalendarView } from './mobile-calendar-view';
import { MobileTaskList } from './mobile-task-list';
import { MobileFoodPlanner } from './mobile-food-planner';
import { MobileEventSheet } from './mobile-event-sheet';
import { MobileQuickAdd } from './mobile-quick-add';
import { MobileMoreSheet, type MoreSection } from './mobile-more-sheet';
import { MobileEntrySheet } from './mobile-entry-sheet';
import { MobileSettingsContent } from './mobile-settings-content';
import { MobileMemberList } from './mobile-member-list';
import { MobileMemberView } from './mobile-member-view';
import { MobileIdagView } from './mobile-idag-view';
import { AiTab } from '@/components/ai-tab';
import type { MobileEntryDraft } from './mobile-entry-draft';

type EntrySheetState =
  | { mode: 'create'; draft?: Partial<MobileEntryDraft> }
  | { mode: 'edit'; entry: Entry };

type Props = {
  members: Member[];
  calendars: Calendar[];
  onRefresh: () => void;
  onNavigateDesktopSection: (section: string) => void;
  presenceByMemberId?: Record<string, AulaPresence>;
};

export function MobileShell({ members, calendars, onRefresh, onNavigateDesktopSection, presenceByMemberId }: Props) {
  const [activeTab, setActiveTab] = useState<MobileTab>('kalender');
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'event' | 'task'>('event');
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreSection, setMoreSection] = useState<MoreSection | null>(null);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [entrySheet, setEntrySheet] = useState<EntrySheetState | null>(null);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);

  function handleTabSelect(tab: MobileTab) {
    if (tab === 'mere') {
      setMoreOpen(true);
      return;
    }
    if (tab !== 'familie') {
      setSelectedMember(null);
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

  // Per-member overlay (from Familie tab)
  if (selectedMember) {
    return (
      <>
        <MobileMemberView
          member={selectedMember}
          onBack={() => setSelectedMember(null)}
          onSelectEntry={setSelectedEntry}
        />
        {/* Event detail sheet needs to be accessible from member view */}
        <MobileEventSheet
          entry={selectedEntry}
          members={members}
          calendars={calendars}
          onClose={() => setSelectedEntry(null)}
          onEdit={handleEditEntry}
          onDeleted={handleEntryDeleted}
        />
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
      </>
    );
  }

  // "Mere" sub-sections: full-screen overlays with a back button
  if (moreSection) {
    const sectionLabel =
      moreSection === 'idag'
        ? 'I dag'
        : moreSection === 'assistent'
          ? 'Assistent'
          : moreSection === 'ai'
            ? 'AI-assistent'
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
            <MobileSettingsContent
              members={members}
              calendars={calendars}
              onRefresh={() => { onRefresh(); setCalendarRefreshKey(k => k + 1); }}
            />
          )}
          {moreSection === 'assistent' && (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-muted-foreground">Brug chat-assistenten på startskærmen.</p>
            </div>
          )}
          {moreSection === 'ai' && (
            <AiTab members={members} />
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
        {activeTab === 'idag' && <MobileIdagView members={members} />}
        {activeTab === 'mad' && <MobileFoodPlanner />}
        {activeTab === 'familie' && (
          <MobileMemberList
            members={members}
            presenceByMemberId={presenceByMemberId}
            onSelectMember={setSelectedMember}
          />
        )}
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
