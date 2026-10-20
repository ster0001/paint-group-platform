#!/usr/bin/env bash
# C1 · a DEV server against the TEST stack, for previewing a worktree while a
# peer's `next start` holds :3101.  ./scripts/c1/dev.sh [port]   (default 3102)
# Same env rules as run-e2e.sh: .env.test.local only, production refused.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${1:-3102}"
if [ ! -f .env.test.local ]; then echo "No .env.test.local — copy it from the main checkout."; exit 1; fi
set -a; source .env.test.local; set +a
export NEXT_PUBLIC_SITE_URL="http://localhost:${PORT}"
node --input-type=module -e "import('./scripts/c1/env.mjs').then((m) => { m.refuseProduction(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''); })"
exec npx next dev -p "$PORT"
