import { NextRequest } from 'next/server';

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function getBackendCandidates(): string[] {
  const configured = process.env.BACKEND_URL;
  const candidates = [
    configured,
    process.env.BACKEND_INTERNAL_URL,
    'http://backend:3000',
    'http://127.0.0.1:3000',
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalizeBaseUrl);

  return [...new Set(candidates)];
}

async function proxyRequest(request: NextRequest, path: string[]): Promise<Response> {
  const url = new URL(request.url);
  const query = url.search || '';
  const encodedPath = path.map(encodeURIComponent).join('/');
  const targetPath = `/api/v1/${encodedPath}${query}`;
  const baseHeaders = new Headers(request.headers);

  // Upstream host is set by fetch target; forwarding original host can break backend routing.
  baseHeaders.delete('host');

  const bodyBuffer = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.arrayBuffer();
  const backendCandidates = getBackendCandidates();
  let lastError: unknown;

  for (const backendBase of backendCandidates) {
    try {
      const upstream = await fetch(`${backendBase}${targetPath}`, {
        method: request.method,
        headers: baseHeaders,
        body: bodyBuffer,
        cache: 'no-store',
        redirect: 'manual',
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete('transfer-encoding');
      responseHeaders.delete('content-encoding');
      responseHeaders.delete('connection');

      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : 'Unable to reach backend API';
  return Response.json(
    {
      message: `API proxy failed for ${targetPath}. ${message}`,
      backendCandidates,
    },
    { status: 502 },
  );
}

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}

export async function OPTIONS(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  return proxyRequest(request, path);
}
