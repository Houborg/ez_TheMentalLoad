import { Pool } from 'pg';
import type { Calendar, Member } from '@mental-load/contracts';
import { runMigrations } from '../database/migrations';
import { InMemoryReminderScheduler, RedisReminderScheduler, type ReminderScheduler } from '../reminders/reminder-scheduler';
import { InMemoryCalendarRepository, type CalendarRepository } from './calendar-repository';
import { InMemoryDailyTimelineRepository, type DailyTimelineRepository } from './daily-timeline-repository';
import { InMemoryEntryRepository, type EntryRepository } from './entry-repository';
import { InMemoryFoodPlanRepository, type FoodPlanRepository } from './food-plan-repository';
import { InMemoryMemberRepository, type MemberRepository } from './member-repository';
import { InMemoryMemberScheduleRepository, type MemberScheduleRepository } from './member-schedule-repository';
import { InMemoryAulaConfirmationRepository, type AulaConfirmationRepository } from './aula-confirmation-repository';
import { PostgresCalendarRepository } from './postgres/calendar-repository';
import { PostgresDailyTimelineRepository } from './postgres/daily-timeline-repository';
import { PostgresEntryRepository } from './postgres/entry-repository';
import { PostgresFoodPlanRepository } from './postgres/food-plan-repository';
import { PostgresMemberRepository } from './postgres/member-repository';
import { PostgresMemberScheduleRepository } from './postgres/member-schedule-repository';
import { PostgresAulaConfirmationRepository } from './postgres/aula-confirmation-repository';

const DEMO_IDS = {
  mom: '11111111-1111-4111-8111-111111111111',
  dad: '22222222-2222-4222-8222-222222222222',
  saga: '33333333-3333-4333-8333-333333333333',
  familyCalendar: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  sagaCalendar: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
} as const;

export interface RepositoryBundle {
  memberRepository: MemberRepository;
  calendarRepository: CalendarRepository;
  entryRepository: EntryRepository;
  foodPlanRepository: FoodPlanRepository;
  dailyTimelineRepository: DailyTimelineRepository;
  memberScheduleRepository: MemberScheduleRepository;
  aulaConfirmationRepository: AulaConfirmationRepository;
  reminderScheduler: ReminderScheduler;
  persistence: 'memory' | 'postgres';
  pool: Pool | null;
  close(): Promise<void>;
}

export async function createRepositoryBundle(): Promise<RepositoryBundle> {
  const scheduler = createReminderScheduler();
  const usePostgres = Boolean(process.env.DATABASE_URL) && (process.env.PERSISTENCE_DRIVER ?? 'memory') === 'postgres';

  if (usePostgres) {
    try {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      await pool.query('select 1');
      await runMigrations(pool);
      await seedIfNeeded(pool);

      return {
        memberRepository: new PostgresMemberRepository(pool),
        calendarRepository: new PostgresCalendarRepository(pool),
        entryRepository: new PostgresEntryRepository(pool),
        foodPlanRepository: new PostgresFoodPlanRepository(pool),
        dailyTimelineRepository: new PostgresDailyTimelineRepository(pool),
        memberScheduleRepository: new PostgresMemberScheduleRepository(pool),
        aulaConfirmationRepository: new PostgresAulaConfirmationRepository(pool),
        reminderScheduler: scheduler,
        persistence: 'postgres',
        pool,
        close: async () => {
          await pool.end();
        },
      };
    } catch (error) {
      console.warn('PostgreSQL unavailable, falling back to in-memory repositories.', error);
    }
  }

  const now = new Date().toISOString();
  const seedMembers: Member[] = [
    { id: DEMO_IDS.mom, name: 'Mom', role: 'parent', createdAt: now },
    { id: DEMO_IDS.dad, name: 'Dad', role: 'parent', createdAt: now },
    { id: DEMO_IDS.saga, name: 'Saga', role: 'child', createdAt: now },
  ];

  const seedCalendars: Calendar[] = [
    { id: DEMO_IDS.familyCalendar, name: 'Family', color: '#6d5efc', ownerMemberId: DEMO_IDS.mom, createdAt: now },
    { id: DEMO_IDS.sagaCalendar, name: 'Saga', color: '#f97316', ownerMemberId: DEMO_IDS.saga, createdAt: now },
  ];

  return {
    memberRepository: new InMemoryMemberRepository(seedMembers),
    calendarRepository: new InMemoryCalendarRepository(seedCalendars),
    entryRepository: new InMemoryEntryRepository(),
    foodPlanRepository: new InMemoryFoodPlanRepository(),
    dailyTimelineRepository: new InMemoryDailyTimelineRepository(),
    memberScheduleRepository: new InMemoryMemberScheduleRepository(),
    aulaConfirmationRepository: new InMemoryAulaConfirmationRepository(),
    reminderScheduler: scheduler,
    persistence: 'memory',
    pool: null,
    close: async () => undefined,
  };
}

function createReminderScheduler(): ReminderScheduler {
  if (process.env.REDIS_URL) {
    try {
      return new RedisReminderScheduler(process.env.REDIS_URL);
    } catch (error) {
      console.warn('Redis unavailable, using in-memory reminder scheduler.', error);
    }
  }

  return new InMemoryReminderScheduler();
}

const DEFAULT_FAMILY_ID = '00000000-0000-4000-8000-000000000001';

async function seedIfNeeded(pool: Pool): Promise<void> {
  const memberCount = await pool.query<{ count: string }>('select count(*)::text as count from members');
  if (memberCount.rows[0]?.count !== '0') {
    return;
  }

  const now = new Date().toISOString();
  await pool.query(
    'insert into members (id, name, role, family_id, created_at) values ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10), ($11, $12, $13, $14, $15)',
    [
      DEMO_IDS.mom, 'Mom', 'parent', DEFAULT_FAMILY_ID, now,
      DEMO_IDS.dad, 'Dad', 'parent', DEFAULT_FAMILY_ID, now,
      DEMO_IDS.saga, 'Saga', 'child', DEFAULT_FAMILY_ID, now,
    ],
  );
  await pool.query(
    'insert into calendars (id, name, color, owner_member_id, family_id, created_at) values ($1, $2, $3, $4, $5, $6), ($7, $8, $9, $10, $11, $12)',
    [
      DEMO_IDS.familyCalendar, 'Family', '#6d5efc', DEMO_IDS.mom, DEFAULT_FAMILY_ID, now,
      DEMO_IDS.sagaCalendar, 'Saga', '#f97316', DEMO_IDS.saga, DEFAULT_FAMILY_ID, now,
    ],
  );
}
