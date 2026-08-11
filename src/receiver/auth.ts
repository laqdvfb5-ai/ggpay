import { createHash, timingSafeEqual } from 'node:crypto';

export function extractBearer(header: string | undefined): string | null {
  const match = header ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
