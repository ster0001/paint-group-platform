#!/usr/bin/env bash
# C1 · run the app against the TEST stack for a manual walk (Tom's phone).
#
#   ./scripts/c1/serve.sh          # builds, then serves on :3101
#
# Same env rules as run-e2e.sh: .env.test.local only, production refused.
# Open http://localhost:3101/account/login — or from a phone on the same
# wifi, http://<this-mac's-IP>:3101/account/login.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env.test.local ]; then
  echo "No .env.test.local — see docs/testing/c1-test-project.md."
  exit 1
fi

set -a; source .env.test.local; set +a
export NEXT_PUBLIC_SITE_URL="http://localhost:3101"

node --input-type=module -e "
  import('./scripts/c1/env.mjs').then((m) => {
    m.refuseProduction(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  })"

echo "Building with the test stack's env…"
npm run build
IP=$(ipconfig getifaddr en0 2>/dev/null || echo "<this-mac's-IP>")
echo ""
echo "Serving the TEST stack on :3101 — on this Mac: http://localhost:3101/account/login"
echo "From your phone (same wifi):  http://${IP}:3101/account/login"
echo "Stop with Ctrl-C."
npx next start -p 3101
