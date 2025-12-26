import { GenericMutationCtx, GenericDataModel } from "convex/server";

type EntityType =
  | "record"
  | "listEntry"
  | "objectType"
  | "attribute"
  | "list"
  | "listAttribute"
  | "action"
  | "workspace"
  | "workspaceMember";

type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "restore"
  | "archive"
  | "action_executed";

type ActorType = "user" | "system" | "action" | "api";

interface Change {
  field: string;
  fieldName?: string;
  before?: unknown;
  after?: unknown;
}

interface AuditLogParams {
  workspaceId: string;
  entityType: EntityType;
  entityId: string;
  objectTypeId?: string;
  action: AuditAction;
  changes: Change[];
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
  actorId?: string;
  actorType: ActorType;
  metadata?: {
    actionId?: string;
    actionExecutionId?: string;
    source?: string;
    ipAddress?: string;
    userAgent?: string;
  };
}

export async function createAuditLog<DataModel extends GenericDataModel>(
  ctx: GenericMutationCtx<DataModel>,
  params: AuditLogParams
): Promise<string> {
  return await ctx.db.insert("auditLogs" as never, {
    ...params,
    timestamp: Date.now(),
  } as never) as unknown as string;
}

export function computeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldNames?: Record<string, string>
): Change[] {
  const changes: Change[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    const beforeValue = before[key];
    const afterValue = after[key];

    if (JSON.stringify(beforeValue) !== JSON.stringify(afterValue)) {
      changes.push({
        field: key,
        fieldName: fieldNames?.[key],
        before: beforeValue,
        after: afterValue,
      });
    }
  }

  return changes;
}
