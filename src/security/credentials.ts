import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface GeneratedApiKey {
  plaintext: string;
  prefix: string;
  secretHash: Buffer;
}

export function generateApiKey(): GeneratedApiKey {
  const prefix = randomBytes(8).toString('hex');
  const secret = randomBytes(24).toString('base64url');
  return {
    plaintext: `gg_live_${prefix}.${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  };
}

export function parseApiKey(value: string): { prefix: string; secret: string } | null {
  const match = /^gg_live_([a-f0-9]{16})\.([A-Za-z0-9_-]{32})$/.exec(value);
  return match ? { prefix: match[1], secret: match[2] } : null;
}

export function hashSecret(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function secretMatches(secret: string, expectedHash: Buffer): boolean {
  return timingSafeEqual(hashSecret(secret), expectedHash);
}

function encryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('WEBHOOK_ENCRYPTION_KEY phải là base64 của đúng 32 bytes');
  }
  return key;
}

export function encryptSecret(plaintext: string, encodedKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptSecret(encrypted: string, encodedKey: string): string {
  const parts = encrypted.split('.');
  if (parts.length !== 3) throw new Error('Webhook secret mã hóa sai định dạng');
  const [iv, tag, ciphertext] = parts.map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
