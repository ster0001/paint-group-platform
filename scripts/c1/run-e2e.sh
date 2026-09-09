#!/usr/bin/env bash
# C1 · run e2e against the TEST stack.
#
#   ./scripts/c1/run-e2e.sh                     # the money suite
#   ./scripts/c1/run-e2e.sh e2e/invoicing.spec.ts   # any spec, on the test stack
#
# Starts a dedicated dev server on :3101 pointed at the TEST Supabase project
# (.env.test.local), so Tom's normal :3000 server and production data are
# never involved. The production tripwire runs before anything starts.
set -euo pipefail
cd "$(dirname "$0")/../.."

if [ ! -f .env.test.local ]; then
  echo "No .env.test.local — see docs/testing/c1-test-project.md for what goes in it."
  exit 1
fi

set -a; source .env.test.local; set +a
export NEXT_PUBLIC_SITE_URL="http://localhost:3101"
export E2E_BASE_URL="http://localhost:3101"
export E2E_C1=1

# Refuse to aim at production, no matter what the env file says.
node --input-type=module -e "
  import('./scripts/c1/env.mjs').then((m) => {
    m.refuseProduction(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
    m.refuseProduction(process.env.C1_DATABASE_URL ?? '');
  })"

# Next 16 allows one DEV server per project dir, and Tom's :3000 (production
# stack) is usually running — so C1 uses a real production build + `next
# start`, which also bakes the TEST project's NEXT_PUBLIC_* values into the
# client bundle the way a deploy would.
echo "Building with the test stack's env…"
npm run build >/tmp/pg-c1-build.log 2>&1 || { echo "Build failed — see /tmp/pg-c1-build.log"; exit 1; }

# A server left behind by an interrupted run keeps the port, `next start`
# fails with EADDRINUSE into a log nobody reads, and every spec then asserts
# against the PREVIOUS build. That has cost two debugging sessions: a wizard
# rewrite "didn't apply" and a passing suite went red for no reason. Refuse
# to start rather than test a stale build.
STALE="$(lsof -ti tcp:3101 -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$STALE" ]; then
  echo "Port 3101 is already held by PID(s): $STALE"
  echo "That is a leftover C1 server — every spec would run against ITS build, not this one."
  echo "Stop it first:  kill $STALE"
  exit 1
fi

echo "Starting the C1 server on :3101 (test stack)…"
npx next start -p 3101 >/tmp/pg-c1-dev.log 2>&1 &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT

for i in $(seq 1 60); do
  # The server dying is not something to wait 60 seconds for.
  if ! kill -0 "$DEV_PID" 2>/dev/null; then
    echo "The C1 server exited on startup — see /tmp/pg-c1-dev.log:"
    tail -5 /tmp/pg-c1-dev.log
    exit 1
  fi
  if curl -s -o /dev/null "http://localhost:3101/login"; then break; fi
  sleep 1
  if [ "$i" = 60 ]; then echo "Server never came up — see /tmp/pg-c1-dev.log"; exit 1; fi
done

npx playwright test "${@:-e2e/stripe-live.spec.ts}"
