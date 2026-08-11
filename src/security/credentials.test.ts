import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  parseApiKey,
  secretMatches,
} from './credentials.js';

describe('tenant API key', () => {
  it('sinh key parse được nhưng không cần lưu plaintext', () => {
    const key = generateApiKey();
    const parsed = parseApiKey(key.plaintext);
    expect(parsed?.prefix).toBe(key.prefix);
    expect(secretMatches(parsed!.secret, key.secretHash)).toBe(true);
  });

  it('từ chối key sai định dạng hoặc secret sai', () => {
    expect(parseApiKey('abc')).toBeNull();
    const key = generateApiKey();
    expect(secretMatches('x'.repeat(32), key.secretHash)).toBe(false);
  });
});

describe('webhook secret encryption', () => {
  const key = randomBytes(32).toString('base64');

  it('mã hóa rồi giải mã giữ nguyên secret', () => {
    const encrypted = encryptSecret('tenant-webhook-secret', key);
    expect(encrypted).not.toContain('tenant-webhook-secret');
    expect(decryptSecret(encrypted, key)).toBe('tenant-webhook-secret');
  });

  it('từ chối encryption key sai độ dài', () => {
    expect(() => encryptSecret('secret', Buffer.from('short').toString('base64')))
      .toThrow(/32 bytes/);
  });
});
