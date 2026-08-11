import { createHash, timingSafeEqual } from 'node:crypto';

export function extractAuthToken(header: string | undefined): string | null {
  // SePay dùng `Authorization: Apikey <token>`. API quản trị của mình vẫn
  // chấp nhận Bearer để curl và integrator dùng chuẩn HTTP quen thuộc.
  const match = header ? /^(?:Bearer|Apikey)\s+(.+)$/i.exec(header.trim()) : null;
  return match?.[1] ?? null;
}

export function tokensMatch(provided: string | null, expected: string): boolean {
  if (provided === null) return false;
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(provided), digest(expected));
}
