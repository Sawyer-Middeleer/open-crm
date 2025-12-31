/**
 * Convert OpenAPI path syntax to Hono path syntax
 * Example: "/{id}" -> "/:id"
 * Example: "/{slug}/entries" -> "/:slug/entries"
 */
export function toHonoPath(openApiPath: string): string {
  return openApiPath.replace(/\{([^}]+)\}/g, ":$1");
}
