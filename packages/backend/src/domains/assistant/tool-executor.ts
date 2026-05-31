import type { AiSuggestion, CreateEntryRequest, FoodPlanDay } from '@mental-load/contracts';
import type { AiSuggestionRepository } from '../../repositories/ai-suggestion-repository.js';

export interface ToolExecutorDeps {
  createEntry: (input: CreateEntryRequest) => Promise<{ id: string }>;
  upsertFoodPlan: (input: { weekStart: string; day: FoodPlanDay; dishName: string; groceryList: string[] }) => Promise<unknown>;
  getDefaultMemberCalendar: () => Promise<{ memberId: string; calendarId: string } | null>;
}

export interface ExecuteResult {
  ok: boolean;
  message: string;
  createdId?: string;
}

export async function executeSuggestion(
  familyId: string,
  suggestion: AiSuggestion,
  deps: ToolExecutorDeps,
  aiSuggestionRepository: AiSuggestionRepository,
): Promise<ExecuteResult> {
  await aiSuggestionRepository.setStatus(familyId, suggestion.id, 'executing');

  try {
    let result: ExecuteResult;

    switch (suggestion.actionType) {
      case 'add_task':
      case 'add_event': {
        const d = suggestion.actionData as {
          title?: string;
          startTime?: string;
          endTime?: string;
          memberId?: string;
          calendarId?: string;
          checklist?: Array<{ text: string; completed?: boolean }>;
        };
        // Fall back to the suggestion text if actionData.title was omitted
        const title = d.title || suggestion.text;
        if (!title) throw new Error(`Missing title for ${suggestion.actionType}`);
        // Fill in missing member/calendar from the first parent if not provided
        let memberId = d.memberId;
        let calendarId = d.calendarId;
        if (!memberId || !calendarId) {
          const defaults = await deps.getDefaultMemberCalendar();
          if (!defaults) throw new Error('No members found to assign task to');
          memberId = memberId ?? defaults.memberId;
          calendarId = calendarId ?? defaults.calendarId;
        }
        // Default times: all-day today for tasks, require times for events
        const isTask = suggestion.actionType === 'add_task';
        if (!isTask && (!d.startTime || !d.endTime)) {
          throw new Error('Missing startTime/endTime for add_event');
        }
        const todayNoon = new Date(); todayNoon.setHours(12, 0, 0, 0);
        const startTime = d.startTime ?? todayNoon.toISOString();
        const endTime = d.endTime ?? new Date(todayNoon.getTime() + 3600000).toISOString();
        const checklist = (d.checklist ?? []).map(item => ({
          text: item.text,
          completed: item.completed ?? false,
        }));
        const created = await deps.createEntry({
          title,
          type: isTask ? 'task' : 'event',
          ownerMemberId: memberId,
          calendarId,
          startTime,
          endTime,
          timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Copenhagen',
          allDay: isTask && !d.startTime,
          checklist,
        });
        const subtaskNote = checklist.length > 0 ? ` (${checklist.length} delopgaver)` : '';
        result = { ok: true, message: `Tilføjet: ${title}${subtaskNote}`, createdId: (created as { id: string }).id };
        break;
      }

      case 'update_food': {
        const d = suggestion.actionData as {
          day?: string;
          dishName?: string;
          groceryList?: string[];
          weekStart?: string;
        };
        if (!d.day) throw new Error('Missing day for update_food');
        const dishName = d.dishName ?? '';
        const weekStart = d.weekStart ?? getThisMonday();
        await deps.upsertFoodPlan({
          weekStart,
          day: normDay(d.day) as FoodPlanDay,
          dishName,
          groceryList: d.groceryList ?? [],
        });
        result = { ok: true, message: `Madplan opdateret: ${dishName || 'tomt'} ${d.day}` };
        break;
      }

      case 'add_grocery': {
        const d = suggestion.actionData as { items?: string[]; day?: string; dishName?: string };
        if (!d.items?.length && !d.dishName) throw new Error('Missing items or dishName for add_grocery');
        const day = normDay(d.day ?? getTodayDay()) as FoodPlanDay;
        const weekStart = getThisMonday();
        await deps.upsertFoodPlan({
          weekStart,
          day,
          dishName: d.dishName ?? 'Indkøb',
          groceryList: d.items ?? [],
        });
        result = { ok: true, message: `Indkøb tilføjet` };
        break;
      }

      case 'set_reminder': {
        // set_reminder: create a task entry as a stand-in for the reminder
        const d = suggestion.actionData as {
          title?: string;
          minutesBefore?: number;
          startTime?: string;
          memberId?: string;
          calendarId?: string;
        };
        if (!d.title || !d.memberId || !d.calendarId) {
          // Minimal fallback: mark as info if we can't create an entry
          result = { ok: true, message: `Påmindelse noteret: ${suggestion.text}` };
          break;
        }
        const startTime = d.startTime ?? new Date(Date.now() + (d.minutesBefore ?? 1440) * 60000).toISOString();
        const endTime = new Date(new Date(startTime).getTime() + 30 * 60000).toISOString();
        const created = await deps.createEntry({
          title: d.title,
          type: 'task',
          ownerMemberId: d.memberId,
          calendarId: d.calendarId,
          startTime,
          endTime,
          timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Copenhagen',
          allDay: false,
        });
        result = { ok: true, message: `Påmindelse tilføjet: ${d.title}`, createdId: (created as { id: string }).id };
        break;
      }

      case 'info':
        result = { ok: true, message: suggestion.text };
        break;

      default:
        throw new Error(`Unknown actionType: ${suggestion.actionType}`);
    }

    await aiSuggestionRepository.setStatus(familyId, suggestion.id, 'done');
    return result;
  } catch (err) {
    await aiSuggestionRepository.setStatus(familyId, suggestion.id, 'pending');
    return { ok: false, message: err instanceof Error ? err.message : 'Execution failed' };
  }
}

function getThisMonday(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay();
  // On Sunday, the "current" food-plan week is the upcoming week (Monday ahead)
  if (day === 0) {
    d.setUTCDate(d.getUTCDate() + 1);
  } else {
    d.setUTCDate(d.getUTCDate() + (1 - day));
  }
  return d.toISOString().slice(0, 10);
}

function getTodayDay(): string {
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
}

const DA_TO_EN_DAY: Record<string, string> = {
  mandag: 'monday', tirsdag: 'tuesday', onsdag: 'wednesday',
  torsdag: 'thursday', fredag: 'friday', lørdag: 'saturday', søndag: 'sunday',
  monday: 'monday', tuesday: 'tuesday', wednesday: 'wednesday',
  thursday: 'thursday', friday: 'friday', saturday: 'saturday', sunday: 'sunday',
};

function normDay(day: string): string {
  return DA_TO_EN_DAY[day.toLowerCase()] ?? day.toLowerCase();
}
