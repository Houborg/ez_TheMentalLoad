import type { Calendar } from '@mental-load/contracts';

export interface CalendarRepository {
  list(familyId?: string): Promise<Calendar[]>;
  findById(id: string, familyId?: string): Promise<Calendar | undefined>;
  create(calendar: Calendar, familyId?: string): Promise<Calendar>;
  delete(id: string, familyId?: string): Promise<void>;
}

export class InMemoryCalendarRepository implements CalendarRepository {
  constructor(private readonly calendars: Calendar[] = []) {}

  async list(_familyId?: string): Promise<Calendar[]> {
    return [...this.calendars];
  }

  async findById(id: string, _familyId?: string): Promise<Calendar | undefined> {
    return this.calendars.find((calendar) => calendar.id === id);
  }

  async create(calendar: Calendar, _familyId?: string): Promise<Calendar> {
    this.calendars.push(calendar);
    return calendar;
  }

  async delete(id: string, _familyId?: string): Promise<void> {
    const idx = this.calendars.findIndex((c) => c.id === id);
    if (idx !== -1) this.calendars.splice(idx, 1);
  }
}
