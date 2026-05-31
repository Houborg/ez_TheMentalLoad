import type { AiSuggestion, CreateEntryRequest, FoodPlanDay } from '@mental-load/contracts';
import type { AiSuggestionRepository } from '../../repositories/ai-suggestion-repository.js';

export interface ToolExecutorDeps {
  createEntry: (input: CreateEntryRequest) => Promise<{ id: string }>;
  upsertFoodPlan: (input: { weekStart: string; day: FoodPlanDay; dishName: string; groceryList: string[] }) => Promise<unknown>;
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
        };
        if (!d.title || !d.startTime || !d.endTime || !d.memberId || !d.calendarId) {
          throw new Error(`Missing required fields for ${suggestion.actionType}`);
        }
        const created = await deps.createEntry({
          title: d.title,
          type: suggestion.actionType === 'add_task' ? 'task' : 'event',
          ownerMemberId: d.memberId,
          calendarId: d.calendarId,
          startTime: d.startTime,
          endTime: d.endTime,
          timezone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Copenhagen',
          allDay: suggestion.actionType === 'add_task',
        });
        result = { ok: true, message: `Tilføjet: ${d.title}`, createdId: (created as { id: string }).id };
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
          day: d.day as FoodPlanDay,
          dishName,
          groceryList: d.groceryList ?? [],
        });
        result = { ok: true, message: `Madplan opdateret: ${dishName || 'tomt'} ${d.day}` };
        break;
      }

      case 'add_grocery': {
        const d = suggestion.actionData as { items?: string[]; day?: string; dishName?: string };
        if (!d.items?.length && !d.dishName) throw new Error('Missing items or dishName for add_grocery');
        const day = (d.day ?? getTodayDay()) as FoodPlanDay;
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
  const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}

function getTodayDay(): string {
  return ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][new Date().getDay()];
}
