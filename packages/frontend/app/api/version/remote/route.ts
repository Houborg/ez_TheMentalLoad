import { NextResponse } from 'next/server';

/**
 * GET /api/version/remote
 *
 * Returns the latest commit on the main branch from GitHub.
 * Used by the Developer settings tab to show whether an update is available.
 *
 * Env vars (set in docker-compose.yml frontend service):
 *   APP_GIT_URL    https://github.com/Owner/Repo.git  (or without .git)
 *   APP_GIT_TOKEN  GitHub personal access token (only needed for private repos)
 */
export async function GET(): Promise<NextResponse> {
  const gitUrl = process.env.APP_GIT_URL;

  if (!gitUrl) {
    return NextResponse.json({ error: 'APP_GIT_URL not configured' }, { status: 503 });
  }

  // Convert git URL to GitHub API URL
  // https://github.com/Owner/Repo.git  →  https://api.github.com/repos/Owner/Repo/commits/main
  const match = gitUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?/);
  if (!match) {
    return NextResponse.json({ error: `Cannot parse GitHub URL: ${gitUrl}` }, { status: 400 });
  }
  const [, owner, repo] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/commits/main`;

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'mentalload-version-check',
  };
  if (process.env.APP_GIT_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.APP_GIT_TOKEN}`;
  }

  try {
    const res = await fetch(apiUrl, { headers, cache: 'no-store' });
    if (!res.ok) {
      return NextResponse.json({ error: `GitHub API returned ${res.status}` }, { status: res.status });
    }
    const data = (await res.json()) as {
      sha?: string;
      commit?: { message?: string; author?: { date?: string } };
    };

    return NextResponse.json({
      sha: data.sha ?? '',
      message: data.commit?.message ?? '',
      date: data.commit?.author?.date ?? '',
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to reach GitHub: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }
}
