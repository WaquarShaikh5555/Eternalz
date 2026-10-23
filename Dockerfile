# Eternalz - Discord bot with AI server administration
#
# The image is intentionally small: the bot only needs Node.js and ffmpeg
# (for the optional voice / media commands).

FROM node:22-slim

# ffmpeg is used by the existing voice features.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install the dependencies first so that the layer is cached.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the application code.
COPY . .

# The SQLite / JSON store lives here - mount a volume to keep it across
# restarts.
RUN mkdir -p /app/data && chown -R node:node /app/data
ENV DATA_DIR=/app/data

USER node

EXPOSE 3000

# The real entry point is index.js.
CMD ["node", "index.js"]
