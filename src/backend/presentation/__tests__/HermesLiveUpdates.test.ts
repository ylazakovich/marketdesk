// Verifies the Hermes WebSocket server authenticates the handshake (CR4), binds
// the workspace from the verified token, and filters broadcasts fail-closed by
// workspace equality (CR5), all over a real ws connection.

import http from 'http';
import { AddressInfo } from 'net';
import { WebSocket } from 'ws';
import { HermesLiveUpdates } from '../websocket/HermesLiveUpdates';
import { signToken } from '../http/middleware/AuthMiddleware';
import type { DomainEvent } from '../../domain/ports/IEventPublisher';

function makeEvent(workspaceId: string): DomainEvent {
  return {
    type: 'hermes.event.created',
    aggregateType: 'hermes_event',
    aggregateId: 'e1',
    payload: { workspaceId, title: 'Price drop suggested' },
    occurredAt: new Date(),
  };
}

// Open an authenticated connection, passing the JWT via the ?token query param.
async function openAuthed(baseUrl: string, workspaceId?: string): Promise<WebSocket> {
  const token = signToken({ userId: 'u-1', workspaceId });
  const ws = new WebSocket(`${baseUrl}?token=${encodeURIComponent(token)}`);
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });
  // Let the server-side connection handler bind the workspace.
  await new Promise((r) => setTimeout(r, 20));
  return ws;
}

describe('HermesLiveUpdates', () => {
  let server: http.Server;
  let live: HermesLiveUpdates;
  let url: string;

  beforeEach(async () => {
    server = http.createServer();
    live = new HermesLiveUpdates();
    live.attach(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { port } = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/api/hermes/live`;
  });

  afterEach(async () => {
    await live.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('rejects an unauthenticated connection (CR4)', async () => {
    const ws = new WebSocket(url); // no token
    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
    });
    expect(closeCode).toBe(4401);
    expect(live.clientCount).toBe(0);
  });

  it('rejects a connection with an invalid token (CR4)', async () => {
    const ws = new WebSocket(`${url}?token=not-a-real-jwt`);
    const closeCode = await new Promise<number>((resolve, reject) => {
      ws.on('close', (code) => resolve(code));
      ws.on('error', reject);
    });
    expect(closeCode).toBe(4401);
    expect(live.clientCount).toBe(0);
  });

  it('accepts an authed connection and binds its workspace from the token (CR4)', async () => {
    const ws = await openAuthed(url, 'ws-1');
    const received = new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (raw) => resolve(JSON.parse(raw.toString())));
    });

    live.broadcast(makeEvent('ws-1'));

    const message = await received;
    expect(message.type).toBe('hermes.event.created');
    expect((message.data as { workspaceId: string }).workspaceId).toBe('ws-1');
    ws.close();
  });

  it('does not deliver events for a different workspace (CR5)', async () => {
    const ws = await openAuthed(url, 'ws-1');
    let delivered = false;
    ws.on('message', () => {
      delivered = true;
    });

    live.broadcast(makeEvent('ws-2'));
    await new Promise((r) => setTimeout(r, 40));

    expect(delivered).toBe(false);
    ws.close();
  });

  it('delivers nothing to a client with no bound workspace — fail closed (CR5)', async () => {
    // Authed token without a workspaceId claim => no workspace bound.
    const ws = await openAuthed(url);
    let delivered = false;
    ws.on('message', () => {
      delivered = true;
    });

    live.broadcast(makeEvent('ws-1'));
    await new Promise((r) => setTimeout(r, 40));

    expect(delivered).toBe(false);
    ws.close();
  });
});
