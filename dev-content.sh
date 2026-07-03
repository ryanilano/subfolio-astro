#!/usr/bin/env bash
# Local runner: points the loader AND the gen-* scripts at the content dir named
# in `.env.content`. Needed because Astro only loads dotenv values into
# process.env at *render* time — not at config time, when the loader resolves
# SUBFOLIO_CONTENT_DIR — and the gen-* scripts (gen-thumbs/gen-rss/gen-oplx)
# read no dotfile at all. So the value has to be promoted to a REAL exported
# shell env var before npm runs.
#
# The file is `.env.content`, NOT `.env`, on purpose: Astro/Vite auto-loads
# `.env` at render time only, which made a plain `npm run build` serve the live
# content tree under /directory/ while the pages came from the fixture — the
# chimeric build that leaked the content repo's .git into dist/ and kept two
# smoke tests permanently red. `.env.content` is invisible to Astro; this
# wrapper is its only consumer, so both build phases always agree.
#
# Set SUBFOLIO_CONTENT_DIR in `.env.content` (gitignored), e.g.:
#   SUBFOLIO_CONTENT_DIR=/path/to/subfolio/directory
# then:
#   ./dev-content.sh           # npm run dev
#   ./dev-content.sh build     # npm run build
#   ./dev-content.sh preview   # npm run preview
#
# If SUBFOLIO_CONTENT_DIR is unset, the scripts fall back to content/examples/.
set -euo pipefail
cd "$(dirname "$0")"

# Extract a single KEY=value from .env.content and export it (only named keys
# are promoted, so anything else in the file is never exported).
export_env_key() {
  local key="$1" line val
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" .env.content | tail -n1 || true)"
  [ -n "$line" ] || return 0
  val="${line#*=}"                 # strip key=
  val="${val%%#*}"                 # strip trailing comment
  val="${val#"${val%%[![:space:]]*}"}"  # ltrim
  val="${val%"${val##*[![:space:]]}"}"  # rtrim
  val="${val%\"}"; val="${val#\"}"     # strip double quotes
  val="${val%\'}"; val="${val#\'}"     # strip single quotes
  export "${key}=${val}"
}

if [ -f .env.content ]; then
  export_env_key SUBFOLIO_CONTENT_DIR
  export_env_key SUBFOLIO_TEXT_RENDERING
  export_env_key SUBFOLIO_CONFIG_DIR
fi

if [ -n "${SUBFOLIO_CONTENT_DIR:-}" ]; then
  echo "→ SUBFOLIO_CONTENT_DIR=$SUBFOLIO_CONTENT_DIR"
else
  echo "→ SUBFOLIO_CONTENT_DIR unset — using bundled content/examples/"
fi

npm run "${1:-dev}"
