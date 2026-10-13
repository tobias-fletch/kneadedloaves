import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import path from "node:path";

// npm retains optional Prisma CLI/compiler peers even with --omit=dev. Only the
// generated client is needed in runtime; it is copied after this pruning step.
const root = process.argv[2];
if (!root || !path.isAbsolute(root)) throw new Error("Pass the absolute production-dependency directory.");
const modules = path.join(root, "node_modules");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (!lock.packages || lock.lockfileVersion !== 3) throw new Error("A version 3 lockfile is required.");
let removed = 0;
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!info.dev && !info.devOptional) continue;
  const target = path.resolve(root, relative);
  if (!relative.startsWith("node_modules/") || !target.startsWith(`${modules}${path.sep}`)) throw new Error(`Invalid dependency path: ${relative}`);
  if (existsSync(target)) removed++;
  rmSync(target, { recursive: true, force: true });
}
const bin = path.join(modules, ".bin");
if (existsSync(bin)) for (const name of readdirSync(bin)) {
  const entry = path.join(bin, name);
  if (!lstatSync(entry).isSymbolicLink()) continue;
  try { realpathSync(entry); } catch { rmSync(entry); }
}
console.log(`Removed ${removed} development/optional-development packages from the runtime dependencies.`);
