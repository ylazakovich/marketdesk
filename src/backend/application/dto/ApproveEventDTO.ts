// Input DTOs for resolving a Hermes event (approve / dismiss). The event must be in
// pending_review; approval applies the proposed change per ARCHITECTURE.md §10.

export interface ApproveEventDTO {
  eventId: string;
  // Tenant of the caller (from the authenticated principal). The event is
  // rejected when it belongs to another workspace (S2).
  workspaceId: string;
  actorId?: string;
}

export interface DismissEventDTO {
  eventId: string;
  workspaceId: string;
  actorId?: string;
  reason?: string;
}
