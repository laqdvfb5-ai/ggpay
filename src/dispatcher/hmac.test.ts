import { describe, expect, it } from 'vitest';
import { signPayload, timestampIsFresh, verifySignature } from './hmac.js';

describe('HMAC', () => {
  it('ký và xác minh', () => { const sig = signPayload('{}', '1000', 'secret'); expect(verifySignature('{}', '1000', 'secret', sig)).toBe(true); });
  it('từ chối chữ ký sai', () => expect(verifySignature('{}', '1000', 'secret', 'abc')).toBe(false));
  it('từ chối timestamp cũ', () => expect(timestampIsFresh('1000', 2000, 300)).toBe(false));
});
