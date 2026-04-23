import type { TimelineTaskInstance } from '@mental-load/contracts';
import type { DailyTimelineRepository } from '../../repositories/daily-timeline-repository';

export class DailyTimelineResetService {
  constructor(private readonly dailyTimelineRepository: DailyTimelineRepository) {}

  async resetDay(memberId: string, date: string, timezone: string): Promise<{ date: string; tasks: TimelineTaskInstance[] }> {
    const day = (await this.dailyTimelineRepository.getTimelineDay(memberId, date))
      ?? (await this.dailyTimelineRepository.createTimelineDay(memberId, date, timezone));

    const tasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);
    const stale = tasks.filter((task) => task.status === 'pending' || task.status === 'waiting_confirmation');

    for (const task of stale) {
      await this.dailyTimelineRepository.updateTimelineTask(task.id, {
        status: 'skipped',
      });
    }

    await this.dailyTimelineRepository.updateTimelineDay(day.id, {
      blockedByTaskId: undefined,
      resetAt: new Date().toISOString(),
    });

    const updatedTasks = await this.dailyTimelineRepository.listTimelineTasks(day.id);
    return { date, tasks: updatedTasks };
  }
}
