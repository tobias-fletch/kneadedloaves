#!/usr/bin/env bash
# Reconstructed isolated harness. Ignores caller DATABASE_URL and refuses environment files.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
for envfile in .env .env.local .env.development .env.development.local; do
  if [[ -f "$REPO/$envfile" ]]; then echo "Refusing to run beside $envfile; use an isolated clean checkout." >&2; exit 1; fi
done
PG="${PG_BIN:?Set PG_BIN to a trusted PostgreSQL bin directory}"
QA_DIR="$(mktemp -d /tmp/kneaded-venmo-rebuilt-qa.XXXXXX)"
export DATABASE_URL='postgresql://agent@127.0.0.1:55497/kneaded_loaves_test?connection_limit=20'
export JWT_SECRET='isolated-venmo-qa-session-secret-never-production-2026'
export CONFIG_ENCRYPTION_KEY='0202020202020202020202020202020202020202020202020202020202020202'
export APP_URL='http://127.0.0.1:3317' TEST_APP_URL='http://127.0.0.1:3317'
unset VENMO_CHECKOUT_ENABLED VENMO_HANDLE VENMO_DESTINATION VENMO_DESTINATION_VERIFIED VENMO_VERIFIED_FINGERPRINT VENMO_DESTINATION_FINGERPRINT PAYMENT_HOLD_MINUTES PAYMENT_WORKERS_READY CHECKOUT_SMOKE_TESTED SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD EMAIL_FROM STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
export TSX_TSCONFIG_PATH="$REPO/tsconfig.json"
"$PG/initdb" -D "$QA_DIR/pgdata" --auth=trust --no-locale --encoding=UTF8 > "$QA_DIR/initdb.log"
"$PG/pg_ctl" -D "$QA_DIR/pgdata" -l "$QA_DIR/postgres.log" -o "-h 127.0.0.1 -p 55497 -c unix_socket_directories=''" start
APP_PID=''
cleanup(){ if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; fi; "$PG/pg_ctl" -D "$QA_DIR/pgdata" stop -m fast; printf '\nReconstructed QA evidence: %s\n' "$QA_DIR"; }
trap cleanup EXIT
cd "$REPO"
DATABASE_URL='postgresql://agent@127.0.0.1:55497/postgres' node - <<'JS'
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.$executeRawUnsafe('CREATE DATABASE kneaded_loaves_test').catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
JS
mkdir -p "$QA_DIR/baseline/prisma/migrations"
cp prisma/schema.prisma "$QA_DIR/baseline/prisma/schema.prisma"
cp prisma/migrations/migration_lock.toml "$QA_DIR/baseline/prisma/migrations/"
for migration in prisma/migrations/202606* prisma/migrations/202607* prisma/migrations/202609*; do cp -a "$migration" "$QA_DIR/baseline/prisma/migrations/"; done
node_modules/.bin/prisma migrate deploy --schema "$QA_DIR/baseline/prisma/schema.prisma" 2>&1 | tee "$QA_DIR/baseline-migrations.log"
node - <<'JS'
const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
await p.$executeRaw`INSERT INTO "Order" ("id","customerEmail","customerName","status","totalCents","fulfillmentType","updatedAt") VALUES ('legacy-qa-order','legacy@example.invalid','Synthetic legacy customer','PENDING',1234,'PICKUP',NOW())`;
await p.$executeRaw`INSERT INTO "User" ("id","email","passwordHash","updatedAt","sessionVersion") VALUES ('legacy-qa-user','legacy-user@example.invalid','synthetic-unusable-hash',NOW(),7)`;
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
JS
node_modules/.bin/prisma migrate deploy 2>&1 | tee "$QA_DIR/migrations.log"
node - <<'JS'
const assert=require('node:assert/strict');const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();
(async()=>{
const order=await p.order.findUniqueOrThrow({where:{id:'legacy-qa-order'}});
assert.equal(order.totalCents,1234);assert.equal(order.customerName,'Synthetic legacy customer');assert.equal(order.status,'PENDING');assert.equal(order.paymentState,'UNPAID');assert.equal(order.paymentMethod,null);assert.equal(order.paymentVerifiedAt,null);assert.equal(order.inventoryRestored,false);
assert.equal((await p.user.findUniqueOrThrow({where:{id:'legacy-qa-user'}})).sessionVersion,7);
await p.order.delete({where:{id:order.id}});await p.user.delete({where:{id:'legacy-qa-user'}});
console.log('PASS: migration preserves legacy order and session version without inventing payment verification');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>p.$disconnect());
JS
node_modules/.bin/prisma migrate deploy 2>&1 | tee "$QA_DIR/migration-replay.log"
node_modules/.bin/next dev --hostname 127.0.0.1 --port 3317 > "$QA_DIR/http-server.log" 2>&1 & APP_PID=$!
node - <<'JS'
(async()=>{for(let i=0;i<120;i++){try{if((await fetch('http://127.0.0.1:3317/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,1000));}throw Error('Server readiness timed out')})().catch(e=>{console.error(e);process.exitCode=1});
JS
node --import tsx tests/manual-payments.integration.ts 2>&1 | tee "$QA_DIR/manual-payments.log"
sha256sum lib/manual-payments.ts lib/checkout-recovery.ts lib/manual-payment-config.ts lib/order-status.ts app/api/checkout/route.ts prisma/schema.prisma prisma/migrations/20261012230000_manual_venmo_payments/migration.sql tests/manual-payments.integration.ts scripts/test-manual-payments.sh > "$QA_DIR/source-hashes.txt"
printf '\nRECONSTRUCTED ISOLATED VENMO SUITE PASSED\n'
