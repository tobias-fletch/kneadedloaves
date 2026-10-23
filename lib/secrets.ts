import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

export function normalizedConfigEncryptionKey(raw = process.env.CONFIG_ENCRYPTION_KEY ?? "") {
  let value = raw.trim();
  const quote = value[0];
  if ((quote === "\"" || quote === "'") && value.length >= 2 && value.at(-1) === quote) value = value.slice(1, -1).trim();
  return value;
}

export function configEncryptionKeyStatus(raw = process.env.CONFIG_ENCRYPTION_KEY ?? "") {
  const value = normalizedConfigEncryptionKey(raw);
  const hexadecimal = value.length > 0 && /^[0-9a-f]+$/i.test(value);
  return { valid: /^[0-9a-f]{64}$/i.test(value), length: value.length, hexadecimal };
}

export function assertConfigEncryptionKey() {
  const status = configEncryptionKeyStatus();
  if (!status.valid) throw new Error(`CONFIG_ENCRYPTION_KEY must contain 64 hexadecimal characters. Observed length ${status.length}; characters are ${status.hexadecimal ? "hexadecimal" : "not hexadecimal"}.`);
}

function key() {
  const value = normalizedConfigEncryptionKey();
  assertConfigEncryptionKey();
  return Buffer.from(value, "hex");
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["enc:v1", iv.toString("hex"), cipher.getAuthTag().toString("hex"), encrypted.toString("hex")].join(":");
}
export function decryptSecret(value: string) {
  if (!value.startsWith("enc:v1:")) {
    if (value && process.env.NODE_ENV === "production") throw new Error("Migrate stored secrets to encrypted values before production.");
    return value;
  }
  const [, , iv, tag, data] = value.split(":");
  const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "hex"));
  cipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([cipher.update(Buffer.from(data, "hex")), cipher.final()]).toString("utf8");
}
