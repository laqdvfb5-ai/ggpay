import { describe, expect, it } from 'vitest';
import { extractAuthToken, tokensMatch } from './auth.js';

describe('webhook auth', () => {
  it('trích Bearer token cho API quản trị', () => {
    expect(extractAuthToken('bearer abc')).toBe('abc');
  });

  it('trích Apikey token đúng định dạng SePay', () => {
    expect(extractAuthToken('Apikey sepay-secret')).toBe('sepay-secret');
  });

  it('không phân biệt hoa thường ở scheme', () => {
    expect(extractAuthToken('APIKEY sepay-secret')).toBe('sepay-secret');
  });

  it('từ chối scheme không hỗ trợ', () => {
    expect(extractAuthToken('Basic abc')).toBeNull();
  });

  it('so sánh token constant-time', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('x', 'abc')).toBe(false);
  });
});
