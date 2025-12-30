import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { createAuditLog, computeChanges } from "../../lib/audit";
import { assertActorInWorkspace } from "../../lib/auth";
import { evaluateTriggers } from "../../lib/triggers";

// ============================================================================
// UNIQUE CONSTRAINT CHECKING
// ============================================================================

interface UniqueCheckResult {
  success: boolean;
  error?: {
    type: "duplicate_value";
    field: string;
    value: unknown;
    existingRecordId: string;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkUniqueConstraints(
  ctx: any,
  workspaceId: Id<"workspaces">,
  objectTypeId: Id<"objectTypes">,
  data: Record<string, unknown>,
  excludeRecordId?: Id<"records">
): Promise<UniqueCheckResult> {
  // Get unique attributes for this object type
  const attributes = await ctx.db
    .query("attributes")
    .withIndex("by_object_type", (q: any) => q.eq("objectTypeId", objectTypeId))
    .collect();

  const uniqueAttrs = attributes.filter((a: any) => a.isUnique);

  if (uniqueAttrs.length === 0) {
    return { success: true };
  }

  for (const attr of uniqueAttrs) {
    const value = data[attr.slug];

    // Skip if value is empty
    if (value === undefined || value === null || value === "") {
      continue;
    }

    // Query for existing records with same value
    const existingRecords = await ctx.db
      .query("records")
      .withIndex("by_workspace_object_type", (q: any) =>
        q.eq("workspaceId", workspaceId).eq("objectTypeId", objectTypeId)
      )
      .collect();

    for (const record of existingRecords) {
      // Skip self on update
      if (excludeRecordId && record._id === excludeRecordId) {
        continue;
      }

      // Skip archived records
      if (record.archivedAt) {
        continue;
      }

      const recordData = record.data as Record<string, unknown>;
      if (recordData[attr.slug] === value) {
        return {
          success: false,
          error: {
            type: "duplicate_value",
            field: attr.slug,
            value,
            existingRecordId: record._id,
          },
        };
      }
    }
  }

  return { success: true };
}

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Get the object type
    const objectType = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug)
      )
      .first();

    if (!objectType) {
      throw new Error(`Object type '${args.objectTypeSlug}' not found`);
    }

    // Get attributes to compute display name
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", objectType._id))
      .collect();

    // Check unique constraints
    const uniqueCheck = await checkUniqueConstraints(
      ctx,
      args.workspaceId,
      objectType._id,
      args.data as Record<string, unknown>
    );

    if (!uniqueCheck.success) {
      return {
        success: false,
        error: uniqueCheck.error,
      };
    }

    // Compute display name from primary attribute
    let displayName: string | undefined;
    if (objectType.displayConfig.primaryAttribute) {
      displayName = String(args.data[objectType.displayConfig.primaryAttribute] ?? "");
    }

    const now = Date.now();

    // Create the record
    const recordId = await ctx.db.insert("records", {
      workspaceId: args.workspaceId,
      objectTypeId: objectType._id,
      data: args.data,
      displayName,
      createdBy: args.actorId,
      createdAt: now,
      updatedAt: now,
    });

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: recordId,
      objectTypeId: objectType._id,
      action: "create",
      changes: Object.entries(args.data).map(([field, value]) => ({
        field,
        after: value,
      })),
      afterSnapshot: args.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    // Evaluate onCreate triggers
    await evaluateTriggers(ctx, {
      workspaceId: args.workspaceId,
      triggerType: "onCreate",
      objectTypeId: objectType._id,
      recordId,
      actorId: args.actorId,
      newData: args.data,
    });

    const record = await ctx.db.get(recordId);

    return {
      recordId,
      record,
    };
  },
});

export const update = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    const objectType = await ctx.db.get(existing.objectTypeId);
    if (!objectType) {
      throw new Error("Object type not found");
    }

    // Merge data
    const newData = { ...existing.data, ...args.data };

    // Check unique constraints (excluding self)
    const uniqueCheck = await checkUniqueConstraints(
      ctx,
      args.workspaceId,
      existing.objectTypeId,
      newData as Record<string, unknown>,
      args.recordId
    );

    if (!uniqueCheck.success) {
      return {
        success: false,
        error: uniqueCheck.error,
      };
    }

    // Recompute display name
    let displayName = existing.displayName;
    if (objectType.displayConfig.primaryAttribute) {
      displayName = String(newData[objectType.displayConfig.primaryAttribute] ?? "");
    }

    const now = Date.now();

    // Compute changes for audit
    const changes = computeChanges(existing.data, newData);

    // Update the record
    await ctx.db.patch(args.recordId, {
      data: newData,
      displayName,
      updatedAt: now,
    });

    // Create audit log
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "update",
      changes,
      beforeSnapshot: existing.data,
      afterSnapshot: newData,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    // Evaluate onUpdate triggers
    const changedFields = changes.map((c) => c.field);
    await evaluateTriggers(ctx, {
      workspaceId: args.workspaceId,
      triggerType: "onUpdate",
      objectTypeId: existing.objectTypeId,
      recordId: args.recordId,
      actorId: args.actorId,
      oldData: existing.data,
      newData,
      changedFields,
    });

    // Evaluate onFieldChange triggers if any fields changed
    if (changedFields.length > 0) {
      await evaluateTriggers(ctx, {
        workspaceId: args.workspaceId,
        triggerType: "onFieldChange",
        objectTypeId: existing.objectTypeId,
        recordId: args.recordId,
        actorId: args.actorId,
        oldData: existing.data,
        newData,
        changedFields,
      });
    }

    const record = await ctx.db.get(args.recordId);

    return {
      recordId: args.recordId,
      record,
    };
  },
});

export const remove = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    // Create audit log before deletion
    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "delete",
      changes: [],
      beforeSnapshot: existing.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    // Evaluate onDelete triggers before deletion
    await evaluateTriggers(ctx, {
      workspaceId: args.workspaceId,
      triggerType: "onDelete",
      objectTypeId: existing.objectTypeId,
      recordId: args.recordId,
      actorId: args.actorId,
      oldData: existing.data,
    });

    // Delete list entries for this record
    const listEntries = await ctx.db
      .query("listEntries")
      .withIndex("by_record", (q) => q.eq("recordId", args.recordId))
      .collect();

    for (const entry of listEntries) {
      await ctx.db.delete(entry._id);
    }

    // Delete the record
    await ctx.db.delete(args.recordId);

    return { success: true };
  },
});

export const archive = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    if (existing.archivedAt) {
      throw new Error("Record is already archived");
    }

    const now = Date.now();

    await ctx.db.patch(args.recordId, {
      archivedAt: now,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "archive",
      changes: [{ field: "archivedAt", before: undefined, after: now }],
      beforeSnapshot: existing.data,
      afterSnapshot: existing.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    const record = await ctx.db.get(args.recordId);

    return { recordId: args.recordId, record };
  },
});

export const restore = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordId: v.id("records"),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const existing = await ctx.db.get(args.recordId);

    if (!existing) {
      throw new Error("Record not found");
    }

    if (existing.workspaceId !== args.workspaceId) {
      throw new Error("Record not found in this workspace");
    }

    if (!existing.archivedAt) {
      throw new Error("Record is not archived");
    }

    const now = Date.now();

    await ctx.db.patch(args.recordId, {
      archivedAt: undefined,
      updatedAt: now,
    });

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.recordId,
      objectTypeId: existing.objectTypeId,
      action: "restore",
      changes: [{ field: "archivedAt", before: existing.archivedAt, after: undefined }],
      beforeSnapshot: existing.data,
      afterSnapshot: existing.data,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "api" },
    });

    const record = await ctx.db.get(args.recordId);

    return { recordId: args.recordId, record };
  },
});

// ============================================================================
// BULK OPERATIONS
// ============================================================================

interface ValidationError {
  type: "missingRequired" | "invalidType" | "invalidFormat" | "duplicateValue" | "other";
  field?: string;
  message: string;
}

function validateRecord(
  data: Record<string, unknown>,
  attributes: Array<{
    slug: string;
    type: string;
    isRequired: boolean;
    config: Record<string, unknown>;
  }>
): ValidationError[] {
  const errors: ValidationError[] = [];

  for (const attr of attributes) {
    const value = data[attr.slug];

    // Check required
    if (attr.isRequired && (value === undefined || value === null || value === "")) {
      errors.push({
        type: "missingRequired",
        field: attr.slug,
        message: `Missing required field: ${attr.slug}`,
      });
      continue;
    }

    // Skip validation for empty optional fields
    if (value === undefined || value === null || value === "") {
      continue;
    }

    // Type-specific validation
    switch (attr.type) {
      case "email":
        if (typeof value === "string" && !value.includes("@")) {
          errors.push({
            type: "invalidFormat",
            field: attr.slug,
            message: `Invalid email format: ${attr.slug}`,
          });
        }
        break;

      case "number":
      case "currency":
        if (typeof value !== "number" && isNaN(Number(value))) {
          errors.push({
            type: "invalidType",
            field: attr.slug,
            message: `Expected number for field: ${attr.slug}`,
          });
        }
        break;

      case "boolean":
        if (typeof value !== "boolean") {
          errors.push({
            type: "invalidType",
            field: attr.slug,
            message: `Expected boolean for field: ${attr.slug}`,
          });
        }
        break;

      case "date":
      case "datetime":
        if (typeof value === "string") {
          const parsed = Date.parse(value);
          if (isNaN(parsed)) {
            errors.push({
              type: "invalidFormat",
              field: attr.slug,
              message: `Invalid date format for field: ${attr.slug}`,
            });
          }
        } else if (typeof value !== "number") {
          errors.push({
            type: "invalidType",
            field: attr.slug,
            message: `Expected date string or timestamp for field: ${attr.slug}`,
          });
        }
        break;

      case "url":
        if (typeof value === "string") {
          try {
            new URL(value);
          } catch {
            errors.push({
              type: "invalidFormat",
              field: attr.slug,
              message: `Invalid URL format for field: ${attr.slug}`,
            });
          }
        }
        break;

      case "select":
        if (attr.config.options && Array.isArray(attr.config.options)) {
          const validValues = attr.config.options.map(
            (o: { value: string }) => o.value
          );
          if (!validValues.includes(value as string)) {
            errors.push({
              type: "invalidFormat",
              field: attr.slug,
              message: `Invalid option for ${attr.slug}. Valid: ${validValues.join(", ")}`,
            });
          }
        }
        break;

      case "multiSelect":
        if (Array.isArray(value) && attr.config.options && Array.isArray(attr.config.options)) {
          const validValues = attr.config.options.map(
            (o: { value: string }) => o.value
          );
          for (const v of value) {
            if (!validValues.includes(v)) {
              errors.push({
                type: "invalidFormat",
                field: attr.slug,
                message: `Invalid option '${v}' for ${attr.slug}`,
              });
            }
          }
        }
        break;
    }
  }

  return errors;
}

export const bulkValidate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    records: v.array(
      v.object({
        data: v.any(),
        externalId: v.optional(v.string()),
      })
    ),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    // Get object type
    const objectType = await ctx.db
      .query("objectTypes")
      .withIndex("by_workspace_slug", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("slug", args.objectTypeSlug)
      )
      .first();

    if (!objectType) {
      throw new Error(`Object type '${args.objectTypeSlug}' not found`);
    }

    // Get attributes
    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", objectType._id))
      .collect();

    const attrList = attributes.map((a) => ({
      slug: a.slug,
      type: a.type,
      isRequired: a.isRequired,
      config: a.config as Record<string, unknown>,
    }));

    // Get unique attributes
    const uniqueAttrs = attributes.filter((a) => a.isUnique);

    // Build index of existing unique values in the database
    const existingUniqueValues: Map<string, Set<string>> = new Map();
    if (uniqueAttrs.length > 0) {
      const existingRecords = await ctx.db
        .query("records")
        .withIndex("by_workspace_object_type", (q) =>
          q.eq("workspaceId", args.workspaceId).eq("objectTypeId", objectType._id)
        )
        .filter((q) => q.eq(q.field("archivedAt"), undefined))
        .collect();

      for (const attr of uniqueAttrs) {
        existingUniqueValues.set(attr.slug, new Set());
        for (const record of existingRecords) {
          const value = (record.data as Record<string, unknown>)[attr.slug];
          if (value !== undefined && value !== null && value !== "") {
            existingUniqueValues.get(attr.slug)!.add(String(value));
          }
        }
      }
    }

    // Track unique values within the batch
    const batchUniqueValues: Map<string, Map<string, number>> = new Map();
    for (const attr of uniqueAttrs) {
      batchUniqueValues.set(attr.slug, new Map()); // value -> first occurrence index
    }

    // Validate each record
    const validatedRecords: Array<{
      data: unknown;
      externalId?: string;
      isValid: boolean;
      errors: string[];
      displayName?: string;
    }> = [];

    const errorsByType: Record<string, { count: number; fields: Set<string> }> = {
      missingRequired: { count: 0, fields: new Set() },
      invalidType: { count: 0, fields: new Set() },
      invalidFormat: { count: 0, fields: new Set() },
      duplicateValue: { count: 0, fields: new Set() },
      other: { count: 0, fields: new Set() },
    };

    let validCount = 0;
    let invalidCount = 0;

    for (let idx = 0; idx < args.records.length; idx++) {
      const record = args.records[idx];
      const data = record.data as Record<string, unknown>;
      const errors = validateRecord(data, attrList);

      // Check unique constraints
      for (const attr of uniqueAttrs) {
        const value = data[attr.slug];
        if (value === undefined || value === null || value === "") {
          continue;
        }

        const stringValue = String(value);

        // Check against existing records
        if (existingUniqueValues.get(attr.slug)?.has(stringValue)) {
          errors.push({
            type: "duplicateValue",
            field: attr.slug,
            message: `Duplicate value for unique field '${attr.slug}': '${stringValue}' already exists`,
          });
          continue;
        }

        // Check against earlier records in this batch
        const batchMap = batchUniqueValues.get(attr.slug)!;
        if (batchMap.has(stringValue)) {
          errors.push({
            type: "duplicateValue",
            field: attr.slug,
            message: `Duplicate value for unique field '${attr.slug}': '${stringValue}' conflicts with record at index ${batchMap.get(stringValue)}`,
          });
        } else {
          batchMap.set(stringValue, idx);
        }
      }

      // Compute display name
      let displayName: string | undefined;
      if (objectType.displayConfig.primaryAttribute) {
        displayName = String(data[objectType.displayConfig.primaryAttribute] ?? "");
      }

      const isValid = errors.length === 0;
      if (isValid) {
        validCount++;
      } else {
        invalidCount++;
        for (const err of errors) {
          if (errorsByType[err.type]) {
            errorsByType[err.type].count++;
            if (err.field) {
              errorsByType[err.type].fields.add(err.field);
            }
          }
        }
      }

      validatedRecords.push({
        data: record.data,
        externalId: record.externalId,
        isValid,
        errors: errors.map((e) => e.message),
        displayName,
      });
    }

    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Store validation session
    const sessionId = await ctx.db.insert("bulkValidationSessions", {
      workspaceId: args.workspaceId,
      objectTypeId: objectType._id,
      records: validatedRecords,
      summary: {
        total: args.records.length,
        valid: validCount,
        invalid: invalidCount,
        errorsByType: Object.fromEntries(
          Object.entries(errorsByType).map(([type, data]) => [
            type,
            { count: data.count, fields: Array.from(data.fields) },
          ])
        ),
      },
      actorId: args.actorId,
      status: "pending",
      createdAt: now,
      expiresAt: now + oneHour,
    });

    // Get sample errors (first 5 invalid records)
    const sampleErrors = validatedRecords
      .map((r, idx) => ({ ...r, index: idx }))
      .filter((r) => !r.isValid)
      .slice(0, 5)
      .map((r) => ({
        index: r.index,
        externalId: r.externalId,
        errors: r.errors,
      }));

    // Get all invalid indices
    const invalidRecordIndices = validatedRecords
      .map((r, idx) => (!r.isValid ? idx : -1))
      .filter((idx) => idx !== -1);

    return {
      sessionId,
      summary: {
        total: args.records.length,
        valid: validCount,
        invalid: invalidCount,
        errors: Object.fromEntries(
          Object.entries(errorsByType)
            .filter(([, data]) => data.count > 0)
            .map(([type, data]) => [
              type,
              { count: data.count, fields: Array.from(data.fields) },
            ])
        ),
      },
      sampleErrors,
      invalidRecordIndices,
    };
  },
});

export const bulkCommit = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    sessionId: v.id("bulkValidationSessions"),
    mode: v.union(v.literal("validOnly"), v.literal("all")),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    // Verify the actor has access to this workspace
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    const session = await ctx.db.get(args.sessionId);

    if (!session) {
      throw new Error("Validation session not found");
    }

    if (session.workspaceId !== args.workspaceId) {
      throw new Error("Session not found in this workspace");
    }

    if (session.status !== "pending") {
      throw new Error(`Session already ${session.status}`);
    }

    if (Date.now() > session.expiresAt) {
      await ctx.db.patch(args.sessionId, { status: "expired" });
      throw new Error("Session has expired");
    }

    const objectType = await ctx.db.get(session.objectTypeId);
    if (!objectType) {
      throw new Error("Object type not found");
    }

    const now = Date.now();
    const recordIds: string[] = [];
    const failures: Array<{ index: number; externalId?: string; error: string }> = [];

    for (let i = 0; i < session.records.length; i++) {
      const record = session.records[i];

      // Skip invalid records if mode is validOnly
      if (!record.isValid && args.mode === "validOnly") {
        failures.push({
          index: i,
          externalId: record.externalId,
          error: record.errors.join("; "),
        });
        continue;
      }

      // Try to insert
      try {
        const recordId = await ctx.db.insert("records", {
          workspaceId: args.workspaceId,
          objectTypeId: session.objectTypeId,
          data: record.data,
          displayName: record.displayName,
          createdBy: args.actorId,
          createdAt: now,
          updatedAt: now,
        });

        recordIds.push(recordId);

        // Create audit log
        await createAuditLog(ctx, {
          workspaceId: args.workspaceId,
          entityType: "record",
          entityId: recordId,
          objectTypeId: session.objectTypeId,
          action: "create",
          changes: Object.entries(record.data as Record<string, unknown>).map(
            ([field, value]) => ({ field, after: value })
          ),
          afterSnapshot: record.data,
          actorId: args.actorId,
          actorType: "user",
          metadata: { source: "bulk_import" },
        });

        // Evaluate onCreate triggers for each record
        await evaluateTriggers(ctx, {
          workspaceId: args.workspaceId,
          triggerType: "onCreate",
          objectTypeId: session.objectTypeId,
          recordId,
          actorId: args.actorId,
          newData: record.data as Record<string, unknown>,
        });
      } catch (error) {
        failures.push({
          index: i,
          externalId: record.externalId,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Mark session as committed
    await ctx.db.patch(args.sessionId, { status: "committed" });

    return {
      inserted: recordIds.length,
      failed: failures.length,
      recordIds,
      failures: failures.slice(0, 10), // Return first 10 failures
    };
  },
});

export const bulkUpdate = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    recordIds: v.array(v.id("records")),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    if (args.recordIds.length === 0) {
      return { total: 0, updated: 0, failed: 0, results: [] };
    }

    const results: Array<{
      recordId: string;
      status: "success" | "failed";
      error?: string;
    }> = [];
    let successCount = 0;
    let failedCount = 0;

    for (const recordId of args.recordIds) {
      try {
        const existing = await ctx.db.get(recordId);

        if (!existing || existing.workspaceId !== args.workspaceId) {
          // Skip records not in this workspace
          continue;
        }

        const objectType = await ctx.db.get(existing.objectTypeId);
        const newData = { ...existing.data, ...args.data };

        // Recompute display name
        let displayName = existing.displayName;
        if (objectType?.displayConfig.primaryAttribute) {
          displayName = String(newData[objectType.displayConfig.primaryAttribute] ?? "");
        }

        const now = Date.now();
        const changes = computeChanges(existing.data, newData);

        await ctx.db.patch(recordId, {
          data: newData,
          displayName,
          updatedAt: now,
        });

        await createAuditLog(ctx, {
          workspaceId: args.workspaceId,
          entityType: "record",
          entityId: recordId,
          objectTypeId: existing.objectTypeId,
          action: "update",
          changes,
          beforeSnapshot: existing.data,
          afterSnapshot: newData,
          actorId: args.actorId,
          actorType: "user",
          metadata: { source: "bulk_update" },
        });

        const changedFields = changes.map((c) => c.field);
        await evaluateTriggers(ctx, {
          workspaceId: args.workspaceId,
          triggerType: "onUpdate",
          objectTypeId: existing.objectTypeId,
          recordId,
          actorId: args.actorId,
          oldData: existing.data,
          newData,
          changedFields,
        });

        if (changedFields.length > 0) {
          await evaluateTriggers(ctx, {
            workspaceId: args.workspaceId,
            triggerType: "onFieldChange",
            objectTypeId: existing.objectTypeId,
            recordId,
            actorId: args.actorId,
            oldData: existing.data,
            newData,
            changedFields,
          });
        }

        results.push({ recordId, status: "success" });
        successCount++;
      } catch (error) {
        results.push({
          recordId,
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        });
        failedCount++;
      }
    }

    return {
      total: args.recordIds.length,
      updated: successCount,
      failed: failedCount,
      results,
    };
  },
});

// ============================================================================
// MERGE OPERATION
// ============================================================================

type MergeStrategy = "targetWins" | "sourceWins" | "union" | "concat" | "skip";

function mergeRecordData(
  targetData: Record<string, unknown>,
  sourceDataList: Array<Record<string, unknown>>,
  defaultStrategy: MergeStrategy,
  overrides: Record<string, MergeStrategy>,
  attributes: Array<{ slug: string; type: string }>
): Record<string, unknown> {
  const result = { ...targetData };

  for (const attr of attributes) {
    const strategy = overrides[attr.slug] ?? defaultStrategy;

    if (strategy === "skip" || strategy === "targetWins") {
      continue;
    }

    if (strategy === "sourceWins") {
      for (const sourceData of sourceDataList) {
        const val = sourceData[attr.slug];
        if (val !== undefined && val !== null && val !== "") {
          result[attr.slug] = val;
          break;
        }
      }
    }

    if (strategy === "union" || strategy === "concat") {
      const isArrayType = attr.type === "multiSelect" || Array.isArray(targetData[attr.slug]);
      if (isArrayType) {
        const targetArr = Array.isArray(targetData[attr.slug])
          ? (targetData[attr.slug] as unknown[])
          : [];
        const allValues = [...targetArr];

        for (const sourceData of sourceDataList) {
          const sourceVal = sourceData[attr.slug];
          if (Array.isArray(sourceVal)) {
            allValues.push(...sourceVal);
          }
        }

        result[attr.slug] = strategy === "union"
          ? [...new Set(allValues)]
          : allValues;
      }
    }
  }

  return result;
}

const mergeStrategyValidator = v.union(
  v.literal("targetWins"),
  v.literal("sourceWins"),
  v.literal("union"),
  v.literal("concat")
);

const fieldOverrideValidator = v.union(
  v.literal("targetWins"),
  v.literal("sourceWins"),
  v.literal("union"),
  v.literal("concat"),
  v.literal("skip")
);

export const merge = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    targetRecordId: v.id("records"),
    sourceRecordIds: v.array(v.id("records")),
    fieldStrategy: v.optional(mergeStrategyValidator),
    fieldOverrides: v.optional(v.record(v.string(), fieldOverrideValidator)),
    transferListMemberships: v.optional(v.boolean()),
    updateInboundReferences: v.optional(v.boolean()),
    deleteSources: v.optional(v.boolean()),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
    await assertActorInWorkspace(ctx, args.workspaceId, args.actorId);

    if (args.sourceRecordIds.length === 0) {
      throw new Error("At least one source record is required");
    }

    // 1. Fetch and validate target
    const target = await ctx.db.get(args.targetRecordId);
    if (!target || target.workspaceId !== args.workspaceId) {
      throw new Error("Target record not found");
    }

    // 2. Fetch and validate sources
    const sources = await Promise.all(
      args.sourceRecordIds.map((id) => ctx.db.get(id))
    );

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      if (!source || source.workspaceId !== args.workspaceId) {
        throw new Error(`Source record not found: ${args.sourceRecordIds[i]}`);
      }
      if (source.objectTypeId !== target.objectTypeId) {
        throw new Error("All records must be the same object type");
      }
      if (source._id === target._id) {
        throw new Error("Target cannot be in source list");
      }
    }

    const validSources = sources as NonNullable<typeof sources[0]>[];

    // 3. Get object type and attributes
    const objectType = await ctx.db.get(target.objectTypeId);
    if (!objectType) {
      throw new Error("Object type not found");
    }

    const attributes = await ctx.db
      .query("attributes")
      .withIndex("by_object_type", (q) => q.eq("objectTypeId", target.objectTypeId))
      .collect();

    const attrList = attributes.map((a) => ({ slug: a.slug, type: a.type }));

    // 4. Merge data
    const strategy = args.fieldStrategy ?? "targetWins";
    const overrides = (args.fieldOverrides ?? {}) as Record<string, MergeStrategy>;

    const mergedData = mergeRecordData(
      target.data as Record<string, unknown>,
      validSources.map((s) => s.data as Record<string, unknown>),
      strategy,
      overrides,
      attrList
    );

    // 5. Update target record
    let displayName = target.displayName;
    if (objectType.displayConfig.primaryAttribute) {
      displayName = String(mergedData[objectType.displayConfig.primaryAttribute] ?? "");
    }

    const now = Date.now();
    await ctx.db.patch(args.targetRecordId, {
      data: mergedData,
      displayName,
      updatedAt: now,
    });

    // 6. Transfer list memberships
    const transferredEntries: Array<{ listId: string; from: string }> = [];
    if (args.transferListMemberships !== false) {
      for (const source of validSources) {
        const entries = await ctx.db
          .query("listEntries")
          .withIndex("by_record", (q) => q.eq("recordId", source._id))
          .collect();

        for (const entry of entries) {
          // Check if target already has this membership
          const existing = await ctx.db
            .query("listEntries")
            .withIndex("by_list_record", (q) =>
              q.eq("listId", entry.listId).eq("recordId", args.targetRecordId)
            )
            .first();

          if (!existing) {
            await ctx.db.insert("listEntries", {
              workspaceId: args.workspaceId,
              listId: entry.listId,
              recordId: args.targetRecordId,
              parentRecordId: entry.parentRecordId,
              data: entry.data,
              addedBy: args.actorId,
              createdAt: now,
              updatedAt: now,
            });
            transferredEntries.push({ listId: entry.listId, from: source._id });
          }

          await ctx.db.delete(entry._id);
        }
      }
    }

    // 7. Update inbound references
    const updatedReferences: Array<{
      recordId: string;
      attribute: string;
      from: string;
      to: string;
    }> = [];

    if (args.updateInboundReferences !== false) {
      // Find reference attributes pointing to this object type
      const refAttributes = await ctx.db
        .query("attributes")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", args.workspaceId))
        .filter((q) => q.eq(q.field("type"), "reference"))
        .collect();

      const relevantAttrs = refAttributes.filter(
        (a) => (a.config as { referencedObjectTypeId?: string })?.referencedObjectTypeId === target.objectTypeId
      );

      const sourceIdSet = new Set(args.sourceRecordIds.map(String));

      for (const attr of relevantAttrs) {
        const recordsWithRef = await ctx.db
          .query("records")
          .withIndex("by_workspace_object_type", (q) =>
            q.eq("workspaceId", args.workspaceId).eq("objectTypeId", attr.objectTypeId)
          )
          .collect();

        for (const record of recordsWithRef) {
          const refValue = (record.data as Record<string, unknown>)[attr.slug];
          if (typeof refValue === "string" && sourceIdSet.has(refValue)) {
            const newData = {
              ...(record.data as Record<string, unknown>),
              [attr.slug]: args.targetRecordId,
            };

            await ctx.db.patch(record._id, {
              data: newData,
              updatedAt: now,
            });

            updatedReferences.push({
              recordId: record._id,
              attribute: attr.slug,
              from: refValue,
              to: args.targetRecordId,
            });

            await evaluateTriggers(ctx, {
              workspaceId: args.workspaceId,
              triggerType: "onUpdate",
              objectTypeId: record.objectTypeId,
              recordId: record._id,
              actorId: args.actorId,
              oldData: record.data as Record<string, unknown>,
              newData,
              changedFields: [attr.slug],
            });
          }
        }
      }
    }

    // 8. Delete source records
    const deletedSourceIds: string[] = [];
    if (args.deleteSources !== false) {
      for (const source of validSources) {
        await evaluateTriggers(ctx, {
          workspaceId: args.workspaceId,
          triggerType: "onDelete",
          objectTypeId: source.objectTypeId,
          recordId: source._id,
          actorId: args.actorId,
          oldData: source.data as Record<string, unknown>,
        });

        // Delete remaining list entries for source
        const remainingEntries = await ctx.db
          .query("listEntries")
          .withIndex("by_record", (q) => q.eq("recordId", source._id))
          .collect();
        for (const entry of remainingEntries) {
          await ctx.db.delete(entry._id);
        }

        await ctx.db.delete(source._id);
        deletedSourceIds.push(source._id);
      }
    }

    // 9. Audit log
    const changes = computeChanges(
      target.data as Record<string, unknown>,
      mergedData
    );

    await createAuditLog(ctx, {
      workspaceId: args.workspaceId,
      entityType: "record",
      entityId: args.targetRecordId,
      objectTypeId: target.objectTypeId,
      action: "update",
      changes,
      beforeSnapshot: target.data,
      afterSnapshot: mergedData,
      actorId: args.actorId,
      actorType: "user",
      metadata: { source: "merge" },
    });

    // 10. Evaluate triggers for target
    const changedFields = changes.map((c) => c.field);
    await evaluateTriggers(ctx, {
      workspaceId: args.workspaceId,
      triggerType: "onUpdate",
      objectTypeId: target.objectTypeId,
      recordId: args.targetRecordId,
      actorId: args.actorId,
      oldData: target.data as Record<string, unknown>,
      newData: mergedData,
      changedFields,
    });

    const updatedRecord = await ctx.db.get(args.targetRecordId);

    return {
      record: updatedRecord,
      mergedSourceCount: validSources.length,
      transferredListEntries: transferredEntries,
      updatedReferences,
      deletedSourceIds,
    };
  },
});
