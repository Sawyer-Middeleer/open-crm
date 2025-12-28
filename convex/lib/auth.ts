import type {
  GenericQueryCtx,
  GenericMutationCtx,
  GenericDataModel,
} from "convex/server";
import type { Id } from "../_generated/dataModel";

export type Role = "owner" | "admin" | "member" | "viewer";

export interface AuthorizedMember {
  memberId: Id<"workspaceMembers">;
  userId: Id<"users">;
  workspaceId: Id<"workspaces">;
  role: Role;
}

/**
 * Verifies that the given actorId (workspaceMember) belongs to the specified workspace.
 * This should be called at the start of every mutation that accepts workspaceId and actorId.
 *
 * @throws Error if the actor is not a member of the workspace
 */
export async function assertActorInWorkspace<DataModel extends GenericDataModel>(
  ctx: GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>,
  workspaceId: Id<"workspaces">,
  actorId: Id<"workspaceMembers">
): Promise<AuthorizedMember> {
  const member = await ctx.db.get(actorId as never);

  if (!member) {
    throw new Error("Unauthorized: Actor not found");
  }

  const typedMember = member as unknown as {
    _id: Id<"workspaceMembers">;
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    role: Role;
  };

  if (typedMember.workspaceId !== workspaceId) {
    throw new Error("Unauthorized: Actor does not have access to this workspace");
  }

  return {
    memberId: typedMember._id,
    userId: typedMember.userId,
    workspaceId: typedMember.workspaceId,
    role: typedMember.role,
  };
}

/**
 * Verifies that the given userId has membership in the specified workspace.
 * This is used for queries where we have a userId but not a workspaceMember ID.
 *
 * @throws Error if the user is not a member of the workspace
 */
export async function assertUserInWorkspace<DataModel extends GenericDataModel>(
  ctx: GenericQueryCtx<DataModel>,
  workspaceId: Id<"workspaces">,
  userId: Id<"users">
): Promise<AuthorizedMember> {
  const membership = await ctx.db
    .query("workspaceMembers" as never)
    .withIndex("by_workspace_user" as never, (q: any) =>
      q.eq("workspaceId", workspaceId).eq("userId", userId)
    )
    .first();

  if (!membership) {
    throw new Error("Unauthorized: User does not have access to this workspace");
  }

  const typedMember = membership as unknown as {
    _id: Id<"workspaceMembers">;
    workspaceId: Id<"workspaces">;
    userId: Id<"users">;
    role: Role;
  };

  return {
    memberId: typedMember._id,
    userId: typedMember.userId,
    workspaceId: typedMember.workspaceId,
    role: typedMember.role,
  };
}

/**
 * Checks if the member has at least the required role level.
 * Role hierarchy: owner > admin > member > viewer
 */
export function hasMinimumRole(memberRole: Role, requiredRole: Role): boolean {
  const roleHierarchy: Record<Role, number> = {
    owner: 4,
    admin: 3,
    member: 2,
    viewer: 1,
  };

  return roleHierarchy[memberRole] >= roleHierarchy[requiredRole];
}

/**
 * Asserts that the member has at least the required role.
 *
 * @throws Error if the member doesn't have sufficient permissions
 */
export function assertMinimumRole(
  member: AuthorizedMember,
  requiredRole: Role,
  operation: string
): void {
  if (!hasMinimumRole(member.role, requiredRole)) {
    throw new Error(
      `Unauthorized: ${operation} requires at least '${requiredRole}' role, but you have '${member.role}'`
    );
  }
}
