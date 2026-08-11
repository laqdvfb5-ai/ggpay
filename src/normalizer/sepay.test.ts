import { describe, expect, it } from 'vitest';
import { normalizeSepay, parseAmountToDong, parseVnDateTime } from './sepay.js';

const payload = { id: 1, gateway: 'MBBank', transactionDate: '2024-05-25 21:11:02', accountNumber: '123', transferType: 'in', transferAmount: '1700000.00', accumulated: 0, referenceCode: 'FT1' };
describe('SePay normalizer', () => {
  it('parse tiền nguyên', () => expect(parseAmountToDong('1700000.00')).toBe(1700000n));
  it('từ chối tiền lẻ', () => expect(() => parseAmountToDong('1.5')).toThrow());
  it('quy giờ Việt Nam sang UTC', () => expect(parseVnDateTime('2024-05-25 21:11:02').toISOString()).toBe('2024-05-25T14:11:02.000Z'));
  it('từ chối ngày không tồn tại', () => expect(() => parseVnDateTime('2024-02-31 10:00:00')).toThrow());
  it('chuẩn hóa payload', () => { const tx = normalizeSepay(payload); expect(tx.amount).toBe(1700000n); expect(tx.balanceAfter).toBe(0n); expect(tx.channel).toBe('api'); });
});
