import "dotenv/config";
import { prisma } from "../lib/prisma";
import { encryptSecret } from "../lib/secrets";
async function main() {
  const rows = await prisma.appConfig.findMany({ where: { secret: true } });
  let changed = 0;
  for (const row of rows) {
    if (!row.value || row.value.startsWith("enc:v1:")) continue;
    await prisma.appConfig.update({ where: { key: row.key }, data: { value: encryptSecret(row.value) } });
    changed++;
  }
  console.log(`Encrypted ${changed} stored secrets. Back up CONFIG_ENCRYPTION_KEY separately from the database.`);
}
main().catch(() => { console.error("Secret migration failed. Verify the encryption key and database connection."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
