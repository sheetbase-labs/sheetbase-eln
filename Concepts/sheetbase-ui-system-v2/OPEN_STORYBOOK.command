#!/bin/bash
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Opening the download page..."
  open "https://nodejs.org/en/download"
  exit 1
fi

URL="http://localhost:6006"
(sleep 1 && open "$URL") &
STATIC_ROOT="storybook-static" PORT=6006 HOST=127.0.0.1 node serve-static.mjs
