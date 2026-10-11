import "dotenv/config";
import { mkdir } from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  const directory = path.resolve(process.env.BACKUP_DIR || "backups");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `bakery-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);
  const result = spawnSync(process.env.PG_DUMP_PATH || "pg_dump", ["--format=custom", "--file", file, "--no-owner", "--no-acl"], {
    env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port || "5432", PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGDATABASE: url.pathname.slice(1), ...(url.searchParams.has("sslmode") ? { PGSSLMODE: url.searchParams.get("sslmode")! } : {}) },
    stdio: ["ignore", "ignore", "pipe"]
  });
  if (result.status !== 0) throw new Error("Backup failed. Check PostgreSQL tools, database access and disk space.");
  console.log(`Backup saved: ${file}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
