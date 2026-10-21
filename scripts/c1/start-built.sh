#!/usr/bin/env bash
# C1 · serve the EXISTING build on :3101 against the TEST stack (no rebuild) — for a
# browser look at what run-e2e.sh just built. Same env rules as serve.sh.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env.test.local ] || { echo "No .env.test.local"; exit 1; }
set -a; source .env.test.local; set +a
export NEXT_PUBLIC_SITE_URL="http://localhost:3101"
node --input-type=module -e "import('./scripts/c1/env.mjs').then((m) => { m.refuseProduction(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); })"
[ -d .next ] || { echo "No .next build — run ./scripts/c1/run-e2e.sh or serve.sh first"; exit 1; }
exec npx next start -p 3101
