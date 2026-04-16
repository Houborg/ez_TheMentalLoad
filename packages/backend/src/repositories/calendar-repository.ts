import type { Calendar } from '@mental-load/contracts';

export interface CalendarRepository {
  list(): Promise<Calendar[]>;
  findById(id: string): Promise<Calendar | undefined>;
  create(calendar: Calendar): Promise<Calendar>;
}

export class InMemoryCalendarRepository implements CalendarRepository {
  constructor(private readonly calendars: Calendar[] = []) {}

  async list(): Promise<Calendar[]> {
    return [...this.calendars];
  }

  async findById(id: string): Promise<Calendar | undefined> {
    return this.calendars.find((calendar) => calendar.id === id);
  }

  async create(calendar: Calendar): Promise<Calendar> {
    this.calendars.push(calendar);
    return calendar;
  }
}
