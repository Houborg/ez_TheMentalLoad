import { NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { verifySessionToken, COOKIE_NAME } from '@/lib/auth';
import { cookies } from 'next/headers';

/**
 * POST /api/update
 *
 * Triggers a self-update by calling the Testbench webhook to rebuild and
 * restart this app's Docker Compose stack.
 *
 * Required env vars (set in docker-compose.yml frontend service):
 *   TESTBENCH_WEBHOOK_URL     e.g. http://testbench-webhook:9001
 *   TESTBENCH_WEBHOOK_SECRET  same secret used by the Testbench stack
 *   APP_SLUG                  e.g. mentalload
 *   APP_GIT_URL               e.g. https://github.com/Houborg/ez_TheMentalLoad.git
 */
export async function POST(): Promise<NextResponse> {
  // Auth — only logged-in users may trigger an update.
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token || !(await verifySessionToken(token))) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const webhookUrl = process.env.TESTBENCH_WEBHOOK_URL;
  const webhookSecret = process.env.TESTBENCH_WEBHOOK_SECRET;
  const slug = process.env.APP_SLUG ?? 'mentalload';
  const gitUrl = process.env.APP_GIT_URL ?? null;

  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json(
      { message: 'Update not configured. Set TESTBENCH_WEBHOOK_URL and TESTBENCH_WEBHOOK_SECRET in the compose file.' },
      { status: 503 },
    );
  }

  const body = JSON.stringify({ slug, gitUrl, gitToken: null });
  const sig = 'sha256=' + createHmac('sha256', webhookSecret).update(body).digest('hex');

  try {
    const res = await fetch(`${webhookUrl}/app-deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': sig },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ message: `Webhook error: ${text}` }, { status: res.status });
    }

    return NextResponse.json({
      ok: true,
      message: 'Update triggered — git pull + Docker rebuild started. The app will restart in ~3–5 minutes.',
    });
  } catch (err) {
    return NextResponse.json(
      { message: `Could not reach Testbench webhook: ${err instanceof Error ? err.message : err}` },
      { status: 502 },
    );
  }
}
