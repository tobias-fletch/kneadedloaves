import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma";
async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || "";
  if (!email || !email.includes("@") || password.length < 12 || Buffer.byteLength(password) > 72) throw new Error("Set ADMIN_EMAIL and a unique ADMIN_PASSWORD of 12–72 UTF-8 bytes.");
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.upsert({ where: { email }, update: { passwordHash, role: "ADMIN", sessionVersion: { increment: 1 } }, create: { email, passwordHash, role: "ADMIN", name: "Bakery Admin" } });
  console.log("Admin account saved. Remove ADMIN_PASSWORD from the environment after use.");
}
main().catch(() => { console.error("Admin setup failed. Check ADMIN_EMAIL, ADMIN_PASSWORD and database configuration."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
