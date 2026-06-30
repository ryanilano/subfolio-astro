#!/usr/bin/env bash
# Local runner: points the loader AND the gen-* scripts at the content dir named
# in `.env`. Needed because Astro only loads `.env` into process.env at *render*
# time — not at config time, when the loader resolves SUBFOLIO_CONTENT_DIR — and
# the gen-* scripts (gen-thumbs/gen-rss/gen-oplx) read no dotfile at all. So the
# value has to be promoted to a REAL exported shell env var before npm runs.
#
# Set SUBFOLIO_CONTENT_DIR in `.env` (gitignored), e.g.:
#   SUBFOLIO_CONTENT_DIR=/path/to/subfolio/directory
# then:
#   ./dev-content.sh           # npm run dev
#   ./dev-content.sh build     # npm run build
#   ./dev-content.sh preview   # npm run preview
#
# If SUBFOLIO_CONTENT_DIR is unset, the scripts fall back to content/examples/.
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  # Extract only SUBFOLIO_CONTENT_DIR so other secrets in .env aren't exported.
  line="$(grep -E '^[[:space:]]*SUBFOLIO_CONTENT_DIR[[:space:]]*=' .env | tail -n1 || true)"
  if [ -n "$line" ]; then
    val="${line#*=}"                 # strip key=
    val="${val%%#*}"                 # strip trailing comment
    val="${val#"${val%%[![:space:]]*}"}"  # ltrim
    val="${val%"${val##*[![:space:]]}"}"  # rtrim
    val="${val%\"}"; val="${val#\"}"     # strip double quotes
    val="${val%\'}"; val="${val#\'}"     # strip single quotes
    export SUBFOLIO_CONTENT_DIR="$val"
  fi
fi

if [ -n "${SUBFOLIO_CONTENT_DIR:-}" ]; then
  echo "→ SUBFOLIO_CONTENT_DIR=$SUBFOLIO_CONTENT_DIR"
else
  echo "→ SUBFOLIO_CONTENT_DIR unset — using bundled content/examples/"
fi

npm run "${1:-dev}"
