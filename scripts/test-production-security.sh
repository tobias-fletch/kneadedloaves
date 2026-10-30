#!/usr/bin/env bash
# New disposable loopback cluster only; never uses caller DB/provider credentials.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for envfile in .env .env.local .env.production .env.production.local .env.development .env.development.local; do
  if [[ -f "$REPO/$envfile" ]]; then echo "Refusing to run beside $envfile; use a clean isolated checkout." >&2; exit 1; fi
done
[[ -f "$REPO/.next/BUILD_ID" ]] || { echo 'Run a production build first.' >&2; exit 1; }
PG="${PG_BIN:?Set PG_BIN to trusted PostgreSQL bin directory}"
[[ -x "$PG/initdb" && -x "$PG/pg_ctl" ]] || { echo 'PostgreSQL tools unavailable.' >&2; exit 1; }
QA_DIR="$(mktemp -d /tmp/kneaded-production-security.XXXXXX)"
APP_PID=''; DB_STARTED=0
stop_app() { if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; APP_PID=''; fi; }
cleanup() { stop_app; if [[ "$DB_STARTED" == 1 ]]; then "$PG/pg_ctl" -D "$QA_DIR/pgdata" stop -m fast; fi; printf '\nSynthetic production security logs: %s\n' "$QA_DIR"; }
trap cleanup EXIT
export DATABASE_URL='postgresql://agent@127.0.0.1:55498/kneaded_loaves_production_security_test?connection_limit=4'
export NODE_ENV='production' JWT_SECRET='isolated-production-security-session-secret-not-for-real-use-2026'
export CONFIG_ENCRYPTION_KEY='0303030303030303030303030303030303030303030303030303030303030303'
export APP_URL='https://bakery.security.example' NEXT_PUBLIC_APP_URL='https://bakery.security.example'
export TEST_APP_URL='http://127.0.0.1:3318' TEST_CANONICAL_ORIGIN='https://bakery.security.example'
export TRUST_PROXY='false' NEXT_TELEMETRY_DISABLED='1' TSX_TSCONFIG_PATH="$REPO/tsconfig.json"
# Placeholder only: lets checkout readiness see site email as configured. Nothing here contacts Resend.
export RESEND_API_KEY='local-placeholder-not-a-real-resend-key'
unset VENMO_CHECKOUT_ENABLED VENMO_HANDLE VENMO_DESTINATION VENMO_DESTINATION_VERIFIED VENMO_VERIFIED_FINGERPRINT PAYMENT_HOLD_MINUTES PAYMENT_WORKERS_READY CHECKOUT_SMOKE_TESTED STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
cd "$REPO"
cp .next/BUILD_ID "$QA_DIR/build-id.txt"
node - <<'JS'
const net = require('node:net');
(async () => { for (const port of [55498, 3318]) await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', () => reject(new Error(`Refusing occupied local port ${port}`)));
  server.listen(port, '127.0.0.1', () => server.close(resolve));
}); })().catch(error => { console.error(error); process.exitCode = 1; });
JS
"$PG/initdb" -D "$QA_DIR/pgdata" --username=agent --auth=trust --no-locale --encoding=UTF8 > "$QA_DIR/initdb.log"
"$PG/pg_ctl" -D "$QA_DIR/pgdata" -l "$QA_DIR/postgres.log" -o "-h 127.0.0.1 -p 55498 -c unix_socket_directories=''" start
DB_STARTED=1
DATABASE_URL='postgresql://agent@127.0.0.1:55498/postgres' node - <<'JS'
const { PrismaClient } = require('@prisma/client'); const prisma = new PrismaClient();
prisma.$executeRawUnsafe('CREATE DATABASE kneaded_loaves_production_security_test').catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
JS
node_modules/.bin/prisma migrate deploy 2>&1 | tee "$QA_DIR/migrations.log"
start_app() {
  node_modules/.bin/next start --hostname 127.0.0.1 --port 3318 > "$QA_DIR/http-$TEST_SECURITY_MODE.log" 2>&1 & APP_PID=$!
  node - <<'JS'
(async () => { for (let attempt = 0; attempt < 90; attempt++) {
  try { if ((await fetch('http://127.0.0.1:3318/api/health')).ok) return; } catch {}
  await new Promise(resolve => setTimeout(resolve, 1000));
} throw new Error('Production server readiness timed out'); })().catch(error => { console.error(error); process.exitCode = 1; });
JS
  kill -0 "$APP_PID" || { echo 'Isolated production process exited.' >&2; return 1; }
}
export TEST_SECURITY_MODE='configured'
start_app
node --import tsx tests/production-security.integration.ts 2>&1 | tee "$QA_DIR/configured-results.log"
stop_app
unset APP_URL NEXT_PUBLIC_APP_URL
export TEST_SECURITY_MODE='missing-origin-config'
start_app
node --import tsx tests/production-security.integration.ts 2>&1 | tee "$QA_DIR/missing-config-results.log"
stop_app
cmp .next/BUILD_ID "$QA_DIR/build-id.txt"
printf '\nISOLATED PRODUCTION SECURITY SUITE PASSED\n'
