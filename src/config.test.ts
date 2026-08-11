import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const valid = { DATABASE_URL: 'postgres://localhost/x', SEPAY_WEBHOOK_TOKEN: 'a', INSPECT_TOKEN: 'b' };
describe('loadConfig', () => {
  it('đọc cấu hình và port mặc định', () => expect(loadConfig(valid).port).toBe(3000));
  it('báo biến thiếu', () => expect(() => loadConfig({ ...valid, INSPECT_TOKEN: undefined })).toThrow(/INSPECT_TOKEN/));
  it('từ chối port sai', () => expect(() => loadConfig({ ...valid, PORT: 'abc' })).toThrow(/PORT/));
});
