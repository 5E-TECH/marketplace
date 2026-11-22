FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY apps ./apps
COPY libs ./libs
RUN npm run build:all
RUN npm prune --omit=dev

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# PDF shriftlari (kirill, ʻ/ʼ): registerPdfFonts dist ichidan yuqoriga qarab
# libs/common/assets/fonts ni topadi — /app/libs/common/assets/fonts.
COPY --chown=node:node libs/common/assets/fonts ./libs/common/assets/fonts
COPY --chown=node:node scripts/health-monitor.mjs ./scripts/health-monitor.mjs
# BE-04: migratsiya CLI (DB_AUTO_MIGRATE=false bo‘lganda deploy qadami) — dist dagi migrate.js larni yurgizadi
COPY --chown=node:node scripts/migrate.mjs ./scripts/migrate.mjs

USER node
CMD ["node", "dist/apps/api-gateway/apps/api-gateway/src/main.js"]
