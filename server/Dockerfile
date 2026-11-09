# Get Rich Quick GIT — save service image.
# Build context is the repo root: the server imports ../shared/game-balance.js.
FROM node:22-alpine
WORKDIR /app
COPY server/package.json ./server/package.json
COPY shared ./shared
RUN cd server && npm install --omit=dev --no-audit --no-fund
COPY server/src ./server/src
EXPOSE 3000
CMD ["node", "server/src/server.js"]
