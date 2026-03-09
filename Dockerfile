FROM node:22-bookworm-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

ENV NODE_ENV=production

RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY . .

RUN mkdir -p /app/database \
    /app/uploads/music \
    /app/uploads/videos \
    /app/uploads/images \
    /app/uploads/projects \
    /app/uploads/documents


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/app.js ./app.js
COPY --from=builder /app/cleanup-orphaned-files.js ./cleanup-orphaned-files.js
COPY --from=builder /app/database ./database
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/public ./public
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/views ./views

RUN mkdir -p /app/database \
    /app/uploads/music \
    /app/uploads/videos \
    /app/uploads/images \
    /app/uploads/projects \
    /app/uploads/documents

EXPOSE 3000

CMD ["node", "app.js"]