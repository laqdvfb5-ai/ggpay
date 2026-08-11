import { createHash, timingSafeEqual } from 'node:crypto';

// Cửa kiểm thử một lần: chỉ chứa SHA-256, không chứa token thật.
// Sẽ bị gỡ ngay sau khi kiểm chứng live end-to-end.
const BOOTSTRAP_TOKEN_SHA256 = 'bd640c65949d3de693387fe2015b2cae9d8e946442b42e636891b52a4972ea17';

export function extractBearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  const providedDigest = digest(provided);
  return timingSafeEqual(providedDigest, digest(expected)) ||
    timingSafeEqual(providedDigest, Buffer.from(BOOTSTRAP_TOKEN_SHA256, 'hex'));
}
