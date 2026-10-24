#!/usr/bin/env bash
# Local-only E2E: throwaway Postgres + next dev + STARTTLS SMTP catcher. Places real guest checkouts
# against the LOCAL app with the real menu, then runs the email worker once, and checks the catcher.
# AdminSettings.emailNotificationsEnabled=false (production-like) in every run. VERCEL=1 so checkout uses the
# production after() -> processOrderEmails path.
#   ADMIN_NOTIFY_EMAIL=kneadedloaves@gmail.com scripts/local-admin-notify-e2e.sh  -> admin email delivered
#   scripts/local-admin-notify-e2e.sh (env unset)                                  -> customer email only, as today
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
export PATH=/workspace/node-v24.22.1-linux-x64/bin:$PATH
PG=/usr/lib/postgresql/17/bin
QA="$(mktemp -d /tmp/kl-notify-e2e.XXXXXX)"; chmod 755 "$QA"
PORT_PG=55498; PORT_APP=3318
export DATABASE_URL="postgresql://$(whoami)@127.0.0.1:$PORT_PG/kl_notify_test"
export JWT_SECRET='local-only-notify-e2e-session-secret-2026-not-prod'
export CONFIG_ENCRYPTION_KEY='0303030303030303030303030303030303030303030303030303030303030303'
export APP_URL="http://127.0.0.1:$PORT_APP" NODE_TLS_REJECT_UNAUTHORIZED=0 NEXT_TELEMETRY_DISABLED=1
unset VERCEL_ENV VENMO_CHECKOUT_ENABLED VENMO_HANDLE VENMO_DESTINATION VENMO_DESTINATION_VERIFIED VENMO_VERIFIED_FINGERPRINT PAYMENT_HOLD_MINUTES PAYMENT_WORKERS_READY CHECKOUT_SMOKE_TESTED SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD EMAIL_FROM STRIPE_SECRET_KEY CONTACT_EMAIL
"$PG/initdb" -D "$QA/pg" --auth=trust --no-locale -E UTF8 >"$QA/initdb.log"
"$PG/pg_ctl" -D "$QA/pg" -l "$QA/pg.log" -o "-h 127.0.0.1 -p $PORT_PG -c unix_socket_directories=''" start >/dev/null
APP=''; CATCH=''
cleanup(){ [[ -n "$APP" ]] && kill "$APP" 2>/dev/null; [[ -n "$CATCH" ]] && kill "$CATCH" 2>/dev/null; "$PG/pg_ctl" -D "$QA/pg" stop -m fast >/dev/null; echo "evidence: $QA"; }
trap cleanup EXIT
"$PG/createdb" -h 127.0.0.1 -p $PORT_PG kl_notify_test
cd "$REPO"
node_modules/.bin/prisma migrate deploy >"$QA/migrate.log" 2>&1
OUT="$QA/mail" node /tmp/kl-smtp-catcher/catcher.js >"$QA/catcher.log" 2>&1 & CATCH=$!
node --import tsx scripts/local-admin-notify-fixture.ts setup
VERCEL=1 node_modules/.bin/next dev --hostname 127.0.0.1 --port $PORT_APP >"$QA/next.log" 2>&1 & APP=$!
for i in $(seq 1 120); do curl -sf "$APP_URL/api/health" >/dev/null && break; sleep 1; done
node --import tsx scripts/local-admin-notify-fixture.ts order A   # DB notifications disabled
sleep 3; node --import tsx scripts/email-worker.ts --once; node --import tsx scripts/email-worker.ts --once; sleep 1
node --import tsx scripts/local-admin-notify-fixture.ts report "$QA/mail"
