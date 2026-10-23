export type LeoWorkspaceId = string;
export type LeoUserId = string;
export type LeoSessionId = string;

export interface LeoUser {
  id: LeoUserId;
  email: string;
  roles: string[];
}

export interface LeoWorkspace {
  id: LeoWorkspaceId;
  ownerId: LeoUserId;
  name: string;
}

export interface LeoSession {
  id: LeoSessionId;
  userId: LeoUserId;
  workspaceId: LeoWorkspaceId;
  expiresAt: Date;
  trustedOrigin: boolean;
}

export interface LeoIdentityContext {
  userId: LeoUserId;
  workspaceId: LeoWorkspaceId;
  sessionId?: LeoSessionId;
  roles: string[];
}
