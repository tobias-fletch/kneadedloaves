FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

FROM base AS production-dependencies
COPY package.json package-lock.json ./
COPY scripts/prune-runtime-dependencies.mjs ./scripts/prune-runtime-dependencies.mjs
# Prisma is generated in the build stage and copied explicitly below. Skipping
# install hooks here prevents a missing Prisma CLI from being fetched at runtime.
# Prune optional development peers but retain production native binaries.
RUN npm ci --omit=dev --ignore-scripts \
    && node scripts/prune-runtime-dependencies.mjs /app \
    && npm cache clean --force

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://kneadedloaves.com
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
RUN npm run build && npm run build:runtime

FROM base AS runtime
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/dist-workers ./dist-workers
# next start must not install a compiler in the runtime image.
COPY --from=build --chown=node:node /app/dist-workers/next.config.mjs ./next.config.mjs
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "start"]
