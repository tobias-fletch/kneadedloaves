import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppConfigValue } from "@/lib/app-config";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "bakery_session";

type SessionPayload = {
  sub: string;
  email: string;
  role: "ADMIN" | "CUSTOMER";
  name?: string | null;
  version?: number;
};

async function jwtSecret() {
  const secret = await getAppConfigValue("JWT_SECRET");
  if (process.env.NODE_ENV === "production" && (secret.length < 32 || /development|replace-with|change-me/i.test(secret))) {
    throw new Error("JWT_SECRET is required in production.");
  }
  return secret || "development-only-secret-change-me";
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signSession(payload: SessionPayload) {
  return jwt.sign(payload, await jwtSecret(), { expiresIn: "7d" });
}

export async function getSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, await jwtSecret(), { algorithms: ["HS256"] }) as SessionPayload;
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return null;
    return { sub: user.id, email: user.email, name: user.name, role: user.role };
  } catch {
    return null;
  }
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.role !== "ADMIN") redirect("/");
  return session;
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } }).catch(() => null);
  if (!user) return null;
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return null;
  if (process.env.NODE_ENV === "production" && ["admin12345", "customer12345"].includes(password)) return null;
  return {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.name
  } satisfies SessionPayload;
}
