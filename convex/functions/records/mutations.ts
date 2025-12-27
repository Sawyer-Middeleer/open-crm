import { mutation } from "../../_generated/server";
import { v } from "convex/values";
import { createAuditLog, computeChanges } from "../../lib/audit";

export const create = mutation({
  args: {
    workspaceId: v.id("workspaces"),
    objectTypeSlug: v.string(),
    data: v.any(),
    actorId: v.id("workspaceMembers"),
  },
  handler: async (ctx, args) => {
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

// ============================================================================
// BULK OPERATIONS
// ============================================================================

interface ValidationError {
  type: "missingRequired" | "invalidType" | "invalidFormat" | "other";
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
          if (!validValues.includes(value)) {
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
      other: { count: 0, fields: new Set() },
    };

    let validCount = 0;
    let invalidCount = 0;

    for (const record of args.records) {
      const data = record.data as Record<string, unknown>;
      const errors = validateRecord(data, attrList);

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
