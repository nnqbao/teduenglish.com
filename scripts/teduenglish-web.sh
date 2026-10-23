#!/bin/zsh
# Runs the production Next.js server on port 4173 (Cloudflare tunnel → teduenglish.com).
# Data lives in Convex Cloud, so there is no local backend to wait for.
set -euo pipefail

readonly ROOT="/Users/vsc_agent/projects/teduenglish"
readonly NODE_BIN="/Users/vsc_agent/.nvm/versions/node/v26.12.1/bin"

export HOME="/Users/vsc_agent"
export PATH="${NODE_BIN}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
export NODE_ENV="production"
cd "$ROOT"

log() { print -r -- "$(date '+%Y-%m-%dT%H:%M:%S%z') $*"; }

if [[ ! -f .next/BUILD_ID ]]; then
  log "no production build found; building"
  npm run build
fi

log "starting Next.js (production) on port 4173"
exec npm start
