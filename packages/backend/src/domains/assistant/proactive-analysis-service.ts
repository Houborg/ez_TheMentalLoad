import Anthropic from '@anthropic-ai/sdk';
import type { AiMemoryRepository } from '../../repositories/ai-memory-repository.js';
import type { AiSuggestionRepository } from '../../repositories/ai-suggestion-repository.js';
import type { AiSuggestion, AiMemoryCategory, AiActionType, AiSuggestionCategory } from '@mental-load/contracts';
import { buildAiContext, type AiContextDeps } from './ai-context-service.js';

const CLAUDE_MODEL = 'claude-haiku-4-5';

const ANALYSIS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'save_memory',
    description: 'Gem en vigtig fact om et familiemedlem eller familien generelt',
    input_schema: {
      type: 'object',
      properties: {
        memberId: { type: 'string', description: 'UUID på familiemedlem (udelad for familie-facts)' },
        category: { type: 'string', enum: ['person', 'preference', 'pattern', 'event'] },
        key: { type: 'string', description: 'Kort beskrivende nøgle, fx "Emil fødselsdag" eller "kan ikke lide fisk"' },
        value: { type: 'string', description: 'Værdien, fx "15. juni" eller "true"' },
      },
      required: ['category', 'key', 'value'],
    },
  },
  {
    name: 'create_suggestion',
    description: 'Opret et forslag til forældrene',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['task', 'food', 'calendar', 'grocery', 'info'] },
        text: { type: 'string', description: 'Forslagstekst på dansk, max 80 tegn' },
        actionType: { type: 'string', enum: ['add_event', 'add_task', 'update_food', 'add_grocery', 'set_reminder', 'info'] },
        actionData: {
          type: 'object',
          description: 'Færdigfyldte parametre til handlingen',
          properties: {
            title: { type: 'string' },
            startTime: { type: 'string' },
            endTime: { type: 'string' },
            memberId: { type: 'string' },
            calendarId: { type: 'string' },
            day: { type: 'string' },
            dishName: { type: 'string' },
            groceryList: { type: 'array', items: { type: 'string' } },
            items: { type: 'array', items: { type: 'string' } },
            entryId: { type: 'string' },
            minutesBefore: { type: 'number' },
          },
        },
      },
      required: ['category', 'text', 'actionType', 'actionData'],
    },
  },
];

export interface ProactiveAnalysisResult {
  memoriesSaved: number;
  suggestionsCreated: number;
  suggestionIds: string[];
}

export async function runProactiveAnalysis(params: {
  familyId: string;
  triggerType: AiSuggestion['triggerType'];
  triggerRef?: string;
  triggerContext?: string;
  contextDeps: AiContextDeps;
  aiMemoryRepository: AiMemoryRepository;
  aiSuggestionRepository: AiSuggestionRepository;
  apiKey?: string;
}): Promise<ProactiveAnalysisResult> {
  const apiKey = params.apiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    console.log('[ai-worker] No ANTHROPIC_API_KEY — skipping proactive analysis');
    return { memoriesSaved: 0, suggestionsCreated: 0, suggestionIds: [] };
  }

  const context = await buildAiContext(params.contextDeps, params.triggerContext);

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1024,
    system: `${context}

Du er proaktiv familieassistent. Analyser familiedataene ovenfor og:
1. Brug save_memory() til at notere 0-3 vigtige facts du har lært
2. Brug create_suggestion() til at foreslå 1-5 nyttige handlinger

Forslag skal være konkrete, handlingsrettede og relevante for DENNE dag/uge.
Forslå ikke ting der allerede er planlagt. Skriv på dansk. Vær kortfattet.`,
    messages: [{ role: 'user', content: 'Analyser familiedata og generer forslag.' }],
    tools: ANALYSIS_TOOLS,
    tool_choice: { type: 'auto' },
  });

  let memoriesSaved = 0;
  const suggestionIds: string[] = [];

  for (const block of response.content) {
    if (block.type !== 'tool_use') continue;

    if (block.name === 'save_memory') {
      const input = block.input as {
        memberId?: string;
        category: AiMemoryCategory;
        key: string;
        value: string;
      };
      await params.aiMemoryRepository.upsert(params.familyId, {
        memberId: input.memberId,
        category: input.category,
        key: input.key,
        value: input.value,
        source: 'ai',
      });
      memoriesSaved++;
    }

    if (block.name === 'create_suggestion') {
      const input = block.input as {
        category: AiSuggestionCategory;
        text: string;
        actionType: AiActionType;
        actionData: Record<string, unknown>;
      };
      const sug = await params.aiSuggestionRepository.create(params.familyId, {
        triggerType: params.triggerType,
        triggerRef: params.triggerRef,
        category: input.category,
        text: input.text,
        actionType: input.actionType,
        actionData: input.actionData,
      });
      suggestionIds.push(sug.id);
    }
  }

  return { memoriesSaved, suggestionsCreated: suggestionIds.length, suggestionIds };
}
