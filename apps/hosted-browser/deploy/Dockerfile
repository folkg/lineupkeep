FROM node:24.22.1-slim
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PORT=8080
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund \
 && ./node_modules/.bin/playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* /root/.npm /ms-playwright/chromium-* /ms-playwright/ffmpeg-* \
 && chmod -R a+rX /ms-playwright
COPY server.mjs ./
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e 'fetch("http://127.0.0.1:" + process.env.PORT + "/healthz").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'
CMD ["node", "server.mjs"]
