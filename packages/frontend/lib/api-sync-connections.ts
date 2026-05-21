import type {
  SyncConnection,
  CreateSyncConnectionRequest,
  UpdateSyncConnectionRequest,
  VerifySyncConnectionRequest,
  VerifySyncConnectionResponse,
  ListRemoteCalendarsRequest,
  RemoteCalendar,
  SyncConnectionRunResponse,
} from '@mental-load/contracts';

import { fetchJson } from './api';

const BASE = '/api/v1/sync/connections';

export function listSyncConnections(): Promise<SyncConnection[]> {
  return fetchJson<SyncConnection[]>(BASE);
}

export function createSyncConnection(body: CreateSyncConnectionRequest): Promise<SyncConnection> {
  return fetchJson<SyncConnection>(BASE, { method: 'POST', body: JSON.stringify(body) });
}

export function updateSyncConnection(id: string, body: UpdateSyncConnectionRequest): Promise<SyncConnection> {
  return fetchJson<SyncConnection>(`${BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteSyncConnection(id: string): Promise<void> {
  return fetchJson<void>(`${BASE}/${id}`, { method: 'DELETE' });
}

export function verifySyncConnection(body: VerifySyncConnectionRequest): Promise<VerifySyncConnectionResponse> {
  return fetchJson<VerifySyncConnectionResponse>(`${BASE}/verify`, { method: 'POST', body: JSON.stringify(body) });
}

export function listRemoteCalendars(body: ListRemoteCalendarsRequest): Promise<{ calendars: RemoteCalendar[] }> {
  return fetchJson<{ calendars: RemoteCalendar[] }>(`${BASE}/calendars`, { method: 'POST', body: JSON.stringify(body) });
}

export function runSyncConnection(id: string): Promise<SyncConnectionRunResponse> {
  return fetchJson<SyncConnectionRunResponse>(`${BASE}/${id}/run`, { method: 'POST' });
}
