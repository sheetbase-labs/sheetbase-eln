#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Opening the Node.js download page..."
  open "https://nodejs.org/en/download"
  exit 1
fi

NODE_MAJOR=$(node -p "Number(process.versions.node.split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20 or newer is required. Current version: $(node --version)"
  open "https://nodejs.org/en/download"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing development dependencies. This normally takes 1–3 minutes on the first run."
  npm ci --no-audit --no-fund
fi

URL="http://localhost:3000"
(sleep 2 && open "$URL") &
echo "TanStack Start development app: $URL"
echo "Keep this Terminal window open. Press Control+C to stop."
npm run dev -- --host 127.0.0.1
