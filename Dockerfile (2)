# Pakai image Puppeteer resmi yang sudah ada Chrome di dalamnya
FROM ghcr.io/puppeteer/puppeteer:22

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    NODE_ENV=production

WORKDIR /app

# Copy package dulu agar layer cache efisien
COPY package.json ./
RUN npm install --omit=dev

# Copy semua source
COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
