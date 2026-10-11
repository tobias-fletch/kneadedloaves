#!/usr/bin/env bash
# Requires a pristine, dedicated local PostgreSQL test database.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO"
export QA_DIR="$(mktemp -d /tmp/bakery-migration-qa.XXXXXX)"
node --input-type=module - <<'JS'
import { PrismaClient } from '@prisma/client';
import { assertIntegrationDatabase } from './tests/integration-qa/guard.mjs';
assertIntegrationDatabase();
const db = new PrismaClient();
try {
  const rows = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public'`;
  if (rows.length) throw new Error('Migration preservation QA requires a pristine test database; it does not reset existing data.');
} finally { await db.$disconnect(); }
JS
mkdir -p "$QA_DIR/prisma/migrations"
cp prisma/schema.prisma "$QA_DIR/prisma/schema.prisma"
cp prisma/migrations/migration_lock.toml "$QA_DIR/prisma/migrations/"
for migration in prisma/migrations/202606* prisma/migrations/202607* prisma/migrations/202609*; do cp -a "$migration" "$QA_DIR/prisma/migrations/"; done
node_modules/.bin/prisma migrate deploy --schema "$QA_DIR/prisma/schema.prisma"
node tests/integration-qa/migration-fixture.mjs seed
node_modules/.bin/prisma migrate deploy
node tests/integration-qa/migration-fixture.mjs verify
node_modules/.bin/prisma migrate deploy
node tests/integration-qa/migration-fixture.mjs verify
printf '\nMigration preservation evidence: %s\n' "$QA_DIR"
