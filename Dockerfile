FROM node:20-alpine

# Install system dependencies
RUN apk add --no-cache python3 ffmpeg curl bash \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy package files
COPY package.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm install --no-audit

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

EXPOSE 3000

CMD ["node", "dist/index.js"]
