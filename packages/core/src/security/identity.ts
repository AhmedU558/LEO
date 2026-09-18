export type WorkspaceId = string;
export type UserId = string;
export type SessionId = string;

export interface User {
  id: UserId;
  email: string;
  roles: string[];
}

export interface Workspace {
  id: WorkspaceId;
  ownerId: UserId;
  name: string;
}

export interface Session {
  id: SessionId;
  userId: UserId;
  workspaceId: WorkspaceId;
  expiresAt: Date;
  trustedOrigin: boolean;
}

export interface IdentityContext {
  userId: UserId;
  workspaceId: WorkspaceId;
  sessionId?: SessionId;
  roles: string[];
}
