import type { Entry, FoodPlanItem, Member } from '@mental-load/contracts';
import type { AiMemoryRepository } from '../../repositories/ai-memory-repository.js';

export interface AiContextDeps {
  familyId: string;
  familyName: string | null;
  listMembers: () => Promise<Member[]>;
  listUpcomingEntries: (from: string, to: string) => Promise<Entry[]>;
  listFoodPlan: (weekStart: string) => Promise<FoodPlanItem[]>;
  aiMemoryRepository: AiMemoryRepository;
}

const DAYS_DA: Record<string, string> = {
  monday: 'Mandag', tuesday: 'Tirsdag', wednesday: 'Onsdag',
  thursday: 'Torsdag', friday: 'Fredag', saturday: 'Lørdag', sunday: 'Søndag',
};

function getMondayStr(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

export async function buildAiContext(deps: AiContextDeps, triggerContext?: string): Promise<string> {
  const { familyId, familyName, listMembers, listUpcomingEntries, listFoodPlan, aiMemoryRepository } = deps;

  const now = new Date();
  const in60Days = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
  const thisWeek = getMondayStr(now);
  const nextWeek = getMondayStr(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000));

  const [members, entries, foodThisWeek, foodNextWeek, memories] = await Promise.all([
    listMembers(),
    listUpcomingEntries(now.toISOString(), in60Days.toISOString()).catch(() => [] as Entry[]),
    listFoodPlan(thisWeek).catch(() => [] as FoodPlanItem[]),
    listFoodPlan(nextWeek).catch(() => [] as FoodPlanItem[]),
    aiMemoryRepository.list(familyId),
  ]);

  const lines: string[] = [];
  const family = familyName ? `familien ${familyName}` : 'familien';
  lines.push(`Du er AI-assistent for ${family}.`);
  lines.push(`Dato i dag: ${now.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
  lines.push('');

  // Members + their memories
  lines.push('FAMILIEMEDLEMMER:');
  for (const m of members) {
    const role = m.role === 'parent' ? 'forælder' : 'barn';
    const memberMemories = memories.filter(mem => mem.memberId === m.id);
    const facts = memberMemories.map(mem => `${mem.key}: ${mem.value}`).join(' · ');
    lines.push(`- ${m.name} (${role})${facts ? ` · ${facts}` : ''}`);
  }

  // Family-wide memories
  const familyMemories = memories.filter(mem => !mem.memberId);
  if (familyMemories.length > 0) {
    lines.push('');
    lines.push('FAMILIEFACTS:');
    familyMemories.forEach(m => lines.push(`- ${m.key}: ${m.value}`));
  }

  // Entries
  lines.push('');
  lines.push('BEGIVENHEDER OG OPGAVER (næste 60 dage):');
  if (entries.length === 0) {
    lines.push('- Ingen kommende begivenheder');
  } else {
    const memberById = Object.fromEntries(members.map(m => [m.id, m.name]));
    for (const e of entries.slice(0, 40)) {
      const start = new Date(e.startTime);
      const dayStr = start.toLocaleDateString('da-DK', { weekday: 'short', day: 'numeric', month: 'short' });
      const timeStr = e.allDay ? 'hele dagen' : start.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
      const who = memberById[e.ownerMemberId] ?? 'Ukendt';
      lines.push(`- [${e.type}] ${dayStr} ${timeStr}: ${e.title} (${who})`);
    }
  }

  // Food plan — include grocery list status so AI can spot missing lists
  lines.push('');
  lines.push('MADPLAN (ret: navn | indkøbsliste: antal varer eller "ingen"):');
  const formatWeek = (items: FoodPlanItem[], label: string) => {
    if (items.length === 0) return `${label}: ingen retter planlagt`;
    const byDay: Record<string, FoodPlanItem> = {};
    items.forEach(i => { byDay[i.day] = i; });
    const parts = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => {
      const item = byDay[d];
      if (!item) return `${DAYS_DA[d]}: (tom)`;
      const groceries = item.groceryList.length > 0
        ? `${item.groceryList.length} varer`
        : 'ingen indkøbsliste';
      return `${DAYS_DA[d]}: ${item.dishName} [${groceries}]`;
    });
    return `${label}:\n  ${parts.join('\n  ')}`;
  };
  lines.push(formatWeek(foodThisWeek, 'Denne uge'));
  lines.push('');
  lines.push(formatWeek(foodNextWeek, 'Næste uge'));

  if (triggerContext) {
    lines.push('');
    lines.push('HVAD SKETE NETOP NU:');
    lines.push(triggerContext);
  }

  return lines.join('\n');
}
