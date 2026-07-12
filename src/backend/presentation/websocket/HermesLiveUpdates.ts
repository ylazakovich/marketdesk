// WebSocket server broadcasting Hermes events to authenticated, workspace-scoped
// clients (ARCHITECTURE.md §6). Transport-agnostic on the inbound side: it consumes
// domain events via the injected IEventSubscriber port (Group 6 wires this to the
// Redis event broker subscription); the outbound side is the `ws` protocol.
//
// Authentication (CR4): the handshake MUST carry a valid JWT. The token is taken
// from the `token` query param on the upgrade URL (simplest for browsers, which
// cannot set Authorization on a WebSocket), falling back to the `Authorization:
// Bearer <jwt>` header. It is verified with the same secret + HS256 pinning as the
// HTTP AuthMiddleware (S5). A missing/invalid token is rejected by closing the
// socket with policy-violation code 4401. The workspaceId is derived from the
// verified token and bound to the connection — clients cannot self-select a
// workspace, so the subscribe message of the old protocol is gone.
//
// Broadcast filtering (CR5): fail CLOSED. An event is delivered to a client only
// when the client's bound workspaceId EQUALS the event's workspaceId. A client with
// no bound workspaceId (or an event with no workspaceId) receives nothing.

import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';
import type { DomainEvent } from '../../domain/ports/IEventPublisher';

export interface IEventSubscriber {
  // Registers a handler for domain events; returns an unsubscribe function.
  subscribe(handler: (event: DomainEvent) => void): () => void;
}

interface VerifiedIdentity {
  userId: string;
  workspaceId?: string;
}

export interface HermesLiveUpdatesDeps {
  subscriber?: IEventSubscriber;
  path?: string;
  // Injectable token verifier (defaults to JWT verify with the env secret + HS256).
  // Exposed for testing; production uses the default.
  verifyToken?: (token: string) => VerifiedIdentity | null;
}

interface ClientMeta {
  userId: string;
  workspaceId?: string;
}

// Policy-violation-style close code for an unauthenticated/invalid WS handshake.
const WS_UNAUTHORIZED = 4401;

export class HermesLiveUpdates {
  private wss?: WebSocketServer;
  private unsubscribe?: () => void;
  private readonly clients = new Map<WebSocket, ClientMeta>();
  private readonly verifyToken: (token: string) => VerifiedIdentity | null;

  constructor(private readonly deps: HermesLiveUpdatesDeps = {}) {
    this.verifyToken = deps.verifyToken ?? defaultVerifyToken;
  }

  attach(server: Server): void {
    const wss = new WebSocketServer({
      server,
      path: this.deps.path ?? '/api/hermes/live',
    });
    this.wss = wss;

    wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      const identity = this.authenticate(request);
      if (!identity) {
        // Reject unauthenticated connections (CR4).
        socket.close(WS_UNAUTHORIZED, 'Unauthorized');
        return;
      }
      // Bind the workspace from the verified token; the client cannot change it.
      this.clients.set(socket, {
        userId: identity.userId,
        workspaceId: identity.workspaceId,
      });
      socket.on('close', () => this.clients.delete(socket));
      socket.on('error', () => this.clients.delete(socket));
    });

    if (this.deps.subscriber) {
      this.unsubscribe = this.deps.subscriber.subscribe((event) =>
        this.broadcast(event),
      );
    }
  }

  // Extract + verify the handshake JWT. Returns the identity or null.
  private authenticate(request: IncomingMessage): VerifiedIdentity | null {
    const token = extractToken(request);
    if (!token) return null;
    return this.verifyToken(token);
  }

  broadcast(event: DomainEvent): void {
    const rawWorkspace = event.payload?.workspaceId;
    const workspaceId = typeof rawWorkspace === 'string' ? rawWorkspace : undefined;
    const message = JSON.stringify({
      type: event.type,
      data: event.payload,
      occurredAt: event.occurredAt,
    });
    for (const [socket, meta] of this.clients) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      // Fail CLOSED (CR5): deliver only on an exact workspace match. A client with
      // no bound workspace, or an event with no workspace, gets nothing.
      if (!meta.workspaceId || !workspaceId) continue;
      if (meta.workspaceId !== workspaceId) continue;
      socket.send(message);
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  async close(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const socket of this.clients.keys()) {
      socket.close();
    }
    this.clients.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    this.wss = undefined;
  }
}

// Pull the JWT from `?token=` (browser-friendly) then the Authorization header.
function extractToken(request: IncomingMessage): string | null {
  try {
    const url = new URL(request.url ?? '', 'http://localhost');
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken.trim();
  } catch {
    // Malformed URL — fall through to the header.
  }
  const header = request.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

// Verify with the same secret + algorithm pinning as the HTTP AuthMiddleware (S5).
function defaultVerifyToken(token: string): VerifiedIdentity | null {
  try {
    const decoded = jwt.verify(token, env.jwt.secret, {
      algorithms: ['HS256'],
    }) as jwt.JwtPayload & { userId?: string; workspaceId?: string };
    if (!decoded.userId) return null;
    return { userId: decoded.userId, workspaceId: decoded.workspaceId };
  } catch {
    return null;
  }
}
