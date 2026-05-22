// packages/backend/src/aula/aula-client.ts
import { aulaRefresh } from './aula-auth.js';
import {
  AulaTokens, AulaChild, AulaCalendarEvent,
  AulaPost, AulaMessage, AulaDailyOverview, AulaAuthExpiredError,
} from './aula-types.js';

const AULA_API = 'https://www.aula.dk/api/v22';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 10; SM-G975F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36';

function apiUrl(method: string, token: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ method, access_token: token, ...extra });
  return `${AULA_API}?${params}`;
}

export class AulaClient {
  private tokens: AulaTokens;
  private onTokenRefresh?: (tokens: AulaTokens) => Promise<void>;

  constructor(tokens: AulaTokens, onTokenRefresh?: (tokens: AulaTokens) => Promise<void>) {
    this.tokens = { ...tokens };
    this.onTokenRefresh = onTokenRefresh;
  }

  private async ensureFreshToken(): Promise<string> {
    const expiresAt = new Date(this.tokens.expiresAt).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) return this.tokens.accessToken;

    try {
      const refreshed = await aulaRefresh(this.tokens.refreshToken);
      this.tokens = refreshed;
      await this.onTokenRefresh?.(refreshed);
      return refreshed.accessToken;
    } catch {
      throw new AulaAuthExpiredError();
    }
  }

  private async get(method: string, extra?: Record<string, string>): Promise<unknown> {
    const token = await this.ensureFreshToken();
    const res = await fetch(apiUrl(method, token, extra), {
      headers: { 'User-Agent': USER_AGENT },
    });
    if (res.status === 401) throw new AulaAuthExpiredError();
    if (!res.ok) throw new Error(`Aula API error: ${method} → ${res.status}`);
    const json = await res.json() as { data?: unknown };
    return json.data ?? json;
  }

  async getChildren(): Promise<AulaChild[]> {
    const data = await this.get('profiles.getProfilesByLogin') as Record<string, unknown>;
    const profiles = data['profiles'] as Array<Record<string, unknown>> | undefined ?? [];
    const children: AulaChild[] = [];
    for (const profile of profiles) {
      const childProfiles = profile['children'] as Array<Record<string, unknown>> | undefined ?? [];
      for (const child of childProfiles) {
        children.push({
          id: child['id'] as number,
          name: child['name'] as string ?? 'Ukendt',
          institutionName: (child['institutionName'] as string | undefined) ?? '',
        });
      }
    }
    return children;
  }

  async getProfileContext(): Promise<{ profileIds: number[]; institutionProfileIds: number[] }> {
    const data = await this.get('profiles.getProfileContext') as Record<string, unknown>;
    const profileIds = (data['profileIds'] as number[] | undefined) ?? [];
    const institutionProfileIds = (data['institutionProfileIds'] as number[] | undefined) ?? [];
    return { profileIds, institutionProfileIds };
  }

  async getCalendarEvents(
    childId: number,
    from: string,
    to: string,
  ): Promise<AulaCalendarEvent[]> {
    const ctx = await this.getProfileContext();
    const data = await this.get('calendar.getEventsByProfileIdsAndResourceIds', {
      profileIds: ctx.profileIds.join(','),
      resourceIds: String(childId),
      start: from,
      end: to,
    }) as Record<string, unknown>;

    const events = (data['events'] as Array<Record<string, unknown>> | undefined) ?? [];
    return events.map(e => ({
      id: String(e['id']),
      title: (e['title'] as string | undefined) ?? 'Aula begivenhed',
      startTime: (e['startDateTime'] ?? e['startDate']) as string,
      endTime: (e['endDateTime'] ?? e['endDate']) as string,
      allDay: Boolean(e['isAllDay']),
      location: e['location'] as string | undefined,
      description: e['description'] as string | undefined,
      childId,
    }));
  }

  async getDailyOverview(childIds: number[]): Promise<AulaDailyOverview[]> {
    const data = await this.get('presence.getDailyOverview', {
      childIds: childIds.join(','),
    }) as Record<string, unknown>;

    const items = (data['dailyOverviews'] as Array<Record<string, unknown>> | undefined) ?? [];
    return items.map(item => ({
      childId: item['childId'] as number,
      date: item['date'] as string,
      status: item['status'] as string | undefined,
      entryTime: item['entryTime'] as string | undefined,
      exitTime: item['exitTime'] as string | undefined,
    }));
  }

  async getThreads(limit = 10): Promise<AulaMessage[]> {
    const data = await this.get('messaging.getThreads', {
      page: '0',
      pageSize: String(limit),
    }) as Record<string, unknown>;

    const threads = (data['threads'] as Array<Record<string, unknown>> | undefined) ?? [];
    const messages: AulaMessage[] = [];
    for (const thread of threads) {
      messages.push({
        id: String(thread['id']),
        threadId: thread['id'] as number,
        subject: thread['subject'] as string | undefined,
        body: ((thread['latestMessage'] as Record<string, unknown> | undefined)?.['text'] as string | undefined) ?? '',
        author: ((thread['latestMessage'] as Record<string, unknown> | undefined)?.['author'] as string | undefined),
        sentAt: thread['latestMessageCreatedAt'] as string | undefined,
      });
    }
    return messages;
  }

  async getPosts(limit = 20): Promise<AulaPost[]> {
    const data = await this.get('posts.getAllPosts', {
      limit: String(limit),
      index: '0',
    }) as Record<string, unknown>;

    const posts = (data['posts'] as Array<Record<string, unknown>> | undefined) ?? [];
    return posts.map(p => ({
      id: String(p['id']),
      title: p['title'] as string | undefined,
      body: (p['text'] ?? p['content'] ?? '') as string,
      author: p['authorName'] as string | undefined,
      publishedAt: p['publishedAt'] as string | undefined,
    }));
  }
}
