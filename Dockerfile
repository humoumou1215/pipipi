# 构建阶段
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN npm run build

# 运行阶段
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/next.config.ts ./
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/bin ./bin
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "bin/pipipi.js", "-H", "0.0.0.0", "-p", "3000"]
