import { describe, test, expect } from "bun:test";
import { createTestApp, jsonRequest } from "./helpers.js";

describe("REST API Smoke Tests", () => {
  // ==========================================================================
  // Records (15 endpoints)
  // ==========================================================================
  describe("Records", () => {
    test("POST /records - create", async () => {
      const app = createTestApp({ mutationResult: { _id: "rec_123" } });
      const res = await app.fetch(
        jsonRequest("/records", "POST", {
          objectType: "people",
          data: { name: "Test Person" },
        })
      );
      expect(res.status).toBe(201);
    });

    test("GET /records/:id - get", async () => {
      const app = createTestApp({
        queryResult: { _id: "rec_123", data: { name: "Test" } },
      });
      const res = await app.fetch(jsonRequest("/records/rec_123"));
      expect(res.status).toBe(200);
    });

    test("GET /records - list", async () => {
      const app = createTestApp({
        queryResult: { page: [], cursor: null, hasMore: false },
      });
      const res = await app.fetch(jsonRequest("/records?objectType=people"));
      expect(res.status).toBe(200);
    });

    test("PATCH /records/:id - update", async () => {
      const app = createTestApp({ mutationResult: { _id: "rec_123" } });
      const res = await app.fetch(
        jsonRequest("/records/rec_123", "PATCH", {
          data: { name: "Updated Name" },
        })
      );
      expect(res.status).toBe(200);
    });

    test("DELETE /records/:id - delete", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(jsonRequest("/records/rec_123", "DELETE"));
      expect(res.status).toBe(200);
    });

    test("POST /records/:id/archive - archive", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/records/rec_123/archive", "POST")
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/:id/restore - restore", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/records/rec_123/restore", "POST")
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/search - search", async () => {
      const app = createTestApp({
        queryResult: { page: [], cursor: null, hasMore: false },
      });
      const res = await app.fetch(
        jsonRequest("/records/search", "POST", {
          objectType: "people",
          filters: [{ field: "name", operator: "contains", value: "Test" }],
        })
      );
      expect(res.status).toBe(200);
    });

    test("GET /records/:id/related - getRelated", async () => {
      const app = createTestApp({
        queryResult: { outbound: [], inbound: [], lists: [] },
      });
      const res = await app.fetch(jsonRequest("/records/rec_123/related"));
      expect(res.status).toBe(200);
    });

    test("GET /records/:id/history - getHistory", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/records/rec_123/history"));
      expect(res.status).toBe(200);
    });

    test("POST /records/bulk/validate - bulkValidate", async () => {
      const app = createTestApp({
        mutationResult: {
          sessionId: "session_123",
          summary: { total: 1, valid: 1, invalid: 0 },
        },
      });
      const res = await app.fetch(
        jsonRequest("/records/bulk/validate", "POST", {
          objectType: "people",
          records: [{ data: { name: "Test" } }],
        })
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/bulk/commit - bulkCommit", async () => {
      const app = createTestApp({
        mutationResult: { inserted: 1, skipped: 0, errors: [] },
      });
      const res = await app.fetch(
        jsonRequest("/records/bulk/commit", "POST", {
          sessionId: "session_123",
        })
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/bulk/inspect - bulkInspect", async () => {
      const app = createTestApp({ queryResult: { records: [] } });
      const res = await app.fetch(
        jsonRequest("/records/bulk/inspect", "POST", {
          sessionId: "session_123",
          indices: [0, 1],
        })
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/bulk/update - bulkUpdate", async () => {
      const app = createTestApp({
        mutationResult: { updated: 2, errors: [] },
      });
      const res = await app.fetch(
        jsonRequest("/records/bulk/update", "POST", {
          recordIds: ["rec_1", "rec_2"],
          data: { status: "active" },
        })
      );
      expect(res.status).toBe(200);
    });

    test("POST /records/merge - merge", async () => {
      const app = createTestApp({
        mutationResult: { targetRecordId: "rec_1", mergedCount: 2 },
      });
      const res = await app.fetch(
        jsonRequest("/records/merge", "POST", {
          targetRecordId: "rec_1",
          sourceRecordIds: ["rec_2", "rec_3"],
        })
      );
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Schema (4 endpoints)
  // ==========================================================================
  describe("Schema", () => {
    test("GET /schema/object-types - list", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/schema/object-types"));
      expect(res.status).toBe(200);
    });

    test("GET /schema/object-types/:slug - get", async () => {
      const app = createTestApp({
        queryResult: { slug: "people", name: "People", attributes: [] },
      });
      const res = await app.fetch(jsonRequest("/schema/object-types/people"));
      expect(res.status).toBe(200);
    });

    test("POST /schema/object-types - create", async () => {
      const app = createTestApp({ mutationResult: { _id: "ot_123" } });
      const res = await app.fetch(
        jsonRequest("/schema/object-types", "POST", {
          name: "Projects",
          singularName: "Project",
          slug: "projects",
        })
      );
      expect(res.status).toBe(201);
    });

    test("POST /schema/object-types/:slug/attributes - createAttribute", async () => {
      const app = createTestApp({ mutationResult: { _id: "attr_123" } });
      const res = await app.fetch(
        jsonRequest("/schema/object-types/projects/attributes", "POST", {
          name: "Due Date",
          slug: "due_date",
          type: "date",
        })
      );
      expect(res.status).toBe(201);
    });
  });

  // ==========================================================================
  // Lists (6 endpoints)
  // ==========================================================================
  describe("Lists", () => {
    test("POST /lists - create", async () => {
      const app = createTestApp({ mutationResult: { _id: "list_123" } });
      const res = await app.fetch(
        jsonRequest("/lists", "POST", {
          name: "Team Members",
          slug: "team_members",
          allowedObjectTypes: ["people"],
        })
      );
      expect(res.status).toBe(201);
    });

    test("GET /lists/:slug/entries - getEntries", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/lists/team_members/entries"));
      expect(res.status).toBe(200);
    });

    test("POST /lists/:slug/entries - addEntry", async () => {
      const app = createTestApp({ mutationResult: { _id: "entry_123" } });
      const res = await app.fetch(
        jsonRequest("/lists/team_members/entries", "POST", {
          recordId: "rec_123",
        })
      );
      expect(res.status).toBe(201);
    });

    test("DELETE /lists/:slug/entries/:recordId - removeEntry", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/lists/team_members/entries/rec_123", "DELETE")
      );
      expect(res.status).toBe(200);
    });

    test("POST /lists/:slug/entries/bulk - bulkAdd", async () => {
      const app = createTestApp({
        mutationResult: { added: 2, errors: [] },
      });
      const res = await app.fetch(
        jsonRequest("/lists/team_members/entries/bulk", "POST", {
          entries: [{ recordId: "rec_1" }, { recordId: "rec_2" }],
        })
      );
      expect(res.status).toBe(200);
    });

    test("DELETE /lists/:slug/entries/bulk - bulkRemove", async () => {
      const app = createTestApp({
        mutationResult: { removed: 2, errors: [] },
      });
      const res = await app.fetch(
        jsonRequest("/lists/team_members/entries/bulk", "DELETE", {
          entries: [{ recordId: "rec_1" }, { recordId: "rec_2" }],
        })
      );
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Actions (4 endpoints)
  // ==========================================================================
  describe("Actions", () => {
    test("GET /actions - list", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/actions"));
      expect(res.status).toBe(200);
    });

    test("POST /actions - create", async () => {
      const app = createTestApp({ mutationResult: { _id: "action_123" } });
      const res = await app.fetch(
        jsonRequest("/actions", "POST", {
          name: "Auto Archive",
          slug: "auto_archive",
          trigger: { type: "onUpdate", objectType: "deals" },
          steps: [
            {
              id: "step1",
              type: "archiveRecord",
              config: { useTriggeredRecord: true },
            },
          ],
        })
      );
      expect(res.status).toBe(201);
    });

    test("DELETE /actions/:id - delete", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(jsonRequest("/actions/action_123", "DELETE"));
      expect(res.status).toBe(200);
    });

    test("POST /actions/:slug/execute - execute", async () => {
      const app = createTestApp({
        mutationResult: { success: true, stepsExecuted: 1 },
      });
      const res = await app.fetch(
        jsonRequest("/actions/auto_archive/execute", "POST", {
          recordId: "rec_123",
        })
      );
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Integrations (7 endpoints)
  // ==========================================================================
  describe("Integrations", () => {
    test("POST /integrations/webhooks - createWebhook", async () => {
      const app = createTestApp({
        mutationResult: { _id: "wh_123", url: "https://...", secret: "..." },
      });
      const res = await app.fetch(
        jsonRequest("/integrations/webhooks", "POST", {
          name: "Slack Notification",
          slug: "slack_notify",
          handlerType: "triggerAction",
          actionSlug: "notify_slack",
        })
      );
      expect(res.status).toBe(201);
    });

    test("GET /integrations/webhooks - listWebhooks", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/integrations/webhooks"));
      expect(res.status).toBe(200);
    });

    test("GET /integrations/webhooks/logs - getWebhookLogs", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/integrations/webhooks/logs"));
      expect(res.status).toBe(200);
    });

    test("POST /integrations/templates - createTemplate", async () => {
      const app = createTestApp({ mutationResult: { _id: "tpl_123" } });
      const res = await app.fetch(
        jsonRequest("/integrations/templates", "POST", {
          name: "Slack Post",
          slug: "slack_post",
          method: "POST",
          url: "https://hooks.slack.com/services/xxx",
        })
      );
      expect(res.status).toBe(201);
    });

    test("GET /integrations/templates - listTemplates", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/integrations/templates"));
      expect(res.status).toBe(200);
    });

    test("POST /integrations/request - sendRequest", async () => {
      const app = createTestApp({
        actionResult: { status: 200, body: { ok: true } },
      });
      const res = await app.fetch(
        jsonRequest("/integrations/request", "POST", {
          method: "GET",
          url: "https://api.example.com/data",
        })
      );
      expect(res.status).toBe(200);
    });

    test("GET /integrations/request/logs - getRequestLogs", async () => {
      const app = createTestApp({ queryResult: [] });
      const res = await app.fetch(jsonRequest("/integrations/request/logs"));
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Users (2 endpoints)
  // ==========================================================================
  describe("Users", () => {
    test("GET /users/me - getCurrentUser", async () => {
      const app = createTestApp({
        queryResult: { _id: "user_123", email: "test@example.com" },
      });
      const res = await app.fetch(jsonRequest("/users/me"));
      expect(res.status).toBe(200);
    });

    test("PATCH /users/me/preferences - updatePreferences", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/users/me/preferences", "PATCH", {
          timezone: "America/New_York",
        })
      );
      expect(res.status).toBe(200);
    });
  });

  // ==========================================================================
  // Workspaces (3 endpoints)
  // ==========================================================================
  describe("Workspaces", () => {
    test("POST /workspaces - create", async () => {
      const app = createTestApp({ mutationResult: { _id: "ws_123" } });
      const res = await app.fetch(
        jsonRequest("/workspaces", "POST", {
          name: "My Workspace",
          slug: "my-workspace",
        })
      );
      expect(res.status).toBe(201);
    });

    test("PATCH /workspaces/members/:id - updateMember", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/workspaces/members/wm_123", "PATCH", {
          role: "admin",
        })
      );
      expect(res.status).toBe(200);
    });

    test("DELETE /workspaces/members/:id - removeMember", async () => {
      const app = createTestApp({ mutationResult: { success: true } });
      const res = await app.fetch(
        jsonRequest("/workspaces/members/wm_123", "DELETE")
      );
      expect(res.status).toBe(200);
    });
  });
});
