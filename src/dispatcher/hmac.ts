import { createHmac, timingSafeEqual } from 'node:crypto';

export function signPayload(body: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
export function verifySignature(body: string, timestamp: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(signPayload(body, timestamp, secret), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function timestampIsFresh(timestamp: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): boolean {
  const value = Number(timestamp);
  return Number.isInteger(value) && Math.abs(nowSeconds - value) <= toleranceSeconds;
}
