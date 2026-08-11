import { describe, expect, it } from 'vitest';
import { extractBearer, tokensMatch } from './auth.js';

describe('bearer auth', () => {
  it('trích token', () => expect(extractBearer('bearer abc')).toBe('abc'));
  it('từ chối định dạng sai', () => expect(extractBearer('Basic abc')).toBeNull());
  it('so sánh token', () => { expect(tokensMatch('abc', 'abc')).toBe(true); expect(tokensMatch('x', 'abc')).toBe(false); });
});
