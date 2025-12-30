/**
 * Scheduled action execution
 * Runs on a cron schedule to check for and execute due scheduled actions
 */

import { internalMutation } from "../../_generated/server";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { evaluateAllConditions } from "../../lib/conditions";
import { isCronDue } from "../../lib/cron";

interface FilterCondition {
  field: string;
  operator: string;
  value?: unknown;
}

/**
 * Main scheduled action checker - runs every minute via cron
 */
export const checkAndExecute = internalMutation({
  handler: async (ctx) => {
    const now = new Date();

    // Find all active scheduled actions
    const scheduledActions = await ctx.db
      .query("actions")
      .withIndex("by_scheduled", (q) =>
        q.eq("isActive", true).eq("triggerType", "scheduled")
      )
      .collect();

    let executionsScheduled = 0;

    for (const action of scheduledActions) {
      // Skip if no schedule defined
      if (!action.trigger.schedule) {
        continue;
      }

      // Check if cron is due now
      if (!isCronDue(action.trigger.schedule, now)) {
        continue;
      }

      try {
        // Find records matching filter conditions
        const records = await findMatchingRecords(ctx, {
          workspaceId: action.workspaceId,
          objectTypeId: action.trigger.objectTypeId,
          filterConditions: action.trigger.filterConditions as
            | FilterCondition[]
            | undefined,
        });

        if (records.length === 0) {
          continue;
        }

        // Get system actor for this workspace
        const systemActor = await getSystemActor(ctx, action.workspaceId);
        if (!systemActor) {
          console.error(
            `[scheduled] No actor found for workspace ${action.workspaceId}`
          );
          continue;
        }

        // Schedule action execution for each matching record
        for (const record of records) {
          await ctx.scheduler.runAfter(
            0,
            internal.functions.actions.mutations.executeInternal,
            {
              workspaceId: action.workspaceId,
              actionId: action._id,
              recordId: record._id,
              actorId: systemActor._id,
              triggeredBy: "scheduled" as const,
            }
          );
          executionsScheduled++;
        }
      } catch (error) {
        // Log error but continue with other actions
        console.error(
          `[scheduled] Error processing action ${action._id}:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    return { checked: scheduledActions.length, executionsScheduled };
  },
});

/**
 * Find records matching filter conditions for a scheduled action
 */
async function findMatchingRecords(
  ctx: { db: any },
  params: {
    workspaceId: Id<"workspaces">;
    objectTypeId?: Id<"objectTypes">;
    filterConditions?: FilterCondition[];
  }
): Promise<Array<{ _id: Id<"records">; data: Record<string, unknown> }>> {
  // Must have an object type to query
  if (!params.objectTypeId) {
    return [];
  }

  // Query records by object type
  let records = await ctx.db
    .query("records")
    .withIndex("by_object_type", (q: any) =>
      q
        .eq("workspaceId", params.workspaceId)
        .eq("objectTypeId", params.objectTypeId)
    )
    .take(1000); // Limit to prevent runaway queries

  // Apply filter conditions in memory
  if (params.filterConditions && params.filterConditions.length > 0) {
    records = records.filter((record: { data: Record<string, unknown> }) =>
      evaluateAllConditions(params.filterConditions!, record.data)
    );
  }

  return records;
}


/**
 * Get a workspace member to use as the actor for scheduled actions
 * Uses the first workspace member found (typically an owner/admin)
 */
async function getSystemActor(
  ctx: { db: any },
  workspaceId: Id<"workspaces">
): Promise<{ _id: Id<"workspaceMembers"> } | null> {
  const member = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace", (q: any) => q.eq("workspaceId", workspaceId))
    .first();

  return member;
}
