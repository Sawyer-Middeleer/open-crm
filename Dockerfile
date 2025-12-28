FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY mcp-server/package.json mcp-server/bun.lock ./
RUN bun install --frozen-lockfile

# Production image
FROM base AS runner

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser

COPY --from=deps /app/node_modules ./node_modules
COPY mcp-server/src ./src
COPY mcp-server/package.json ./

# Change ownership to non-root user
RUN chown -R appuser:nodejs /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

# Switch to non-root user
USER appuser

CMD ["bun", "run", "src/index.ts"]
