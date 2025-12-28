/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as functions_actions_mutations from "../functions/actions/mutations.js";
import type * as functions_actions_queries from "../functions/actions/queries.js";
import type * as functions_attributes_mutations from "../functions/attributes/mutations.js";
import type * as functions_audit_queries from "../functions/audit/queries.js";
import type * as functions_auth_mutations from "../functions/auth/mutations.js";
import type * as functions_auth_queries from "../functions/auth/queries.js";
import type * as functions_integrations_httpActions from "../functions/integrations/httpActions.js";
import type * as functions_integrations_mutations from "../functions/integrations/mutations.js";
import type * as functions_integrations_queries from "../functions/integrations/queries.js";
import type * as functions_integrations_webhookHandlers from "../functions/integrations/webhookHandlers.js";
import type * as functions_lists_mutations from "../functions/lists/mutations.js";
import type * as functions_lists_queries from "../functions/lists/queries.js";
import type * as functions_objectTypes_mutations from "../functions/objectTypes/mutations.js";
import type * as functions_objectTypes_queries from "../functions/objectTypes/queries.js";
import type * as functions_records_mutations from "../functions/records/mutations.js";
import type * as functions_records_queries from "../functions/records/queries.js";
import type * as functions_workspaces_mutations from "../functions/workspaces/mutations.js";
import type * as functions_workspaces_queries from "../functions/workspaces/queries.js";
import type * as http from "../http.js";
import type * as lib_actionContext from "../lib/actionContext.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_urlValidation from "../lib/urlValidation.js";
import type * as lib_validation from "../lib/validation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "functions/actions/mutations": typeof functions_actions_mutations;
  "functions/actions/queries": typeof functions_actions_queries;
  "functions/attributes/mutations": typeof functions_attributes_mutations;
  "functions/audit/queries": typeof functions_audit_queries;
  "functions/auth/mutations": typeof functions_auth_mutations;
  "functions/auth/queries": typeof functions_auth_queries;
  "functions/integrations/httpActions": typeof functions_integrations_httpActions;
  "functions/integrations/mutations": typeof functions_integrations_mutations;
  "functions/integrations/queries": typeof functions_integrations_queries;
  "functions/integrations/webhookHandlers": typeof functions_integrations_webhookHandlers;
  "functions/lists/mutations": typeof functions_lists_mutations;
  "functions/lists/queries": typeof functions_lists_queries;
  "functions/objectTypes/mutations": typeof functions_objectTypes_mutations;
  "functions/objectTypes/queries": typeof functions_objectTypes_queries;
  "functions/records/mutations": typeof functions_records_mutations;
  "functions/records/queries": typeof functions_records_queries;
  "functions/workspaces/mutations": typeof functions_workspaces_mutations;
  "functions/workspaces/queries": typeof functions_workspaces_queries;
  http: typeof http;
  "lib/actionContext": typeof lib_actionContext;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/urlValidation": typeof lib_urlValidation;
  "lib/validation": typeof lib_validation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
