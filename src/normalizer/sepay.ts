import type { CanonicalTransaction, Direction } from '../contract.js';

export class NormalizeError extends Error {
  constructor(public readonly field: string, message: string) { super(message); this.name = 'NormalizeError'; }
}

function requireField(body: Record<string, unknown>, name: string): unknown {
  const value = body[name];
  if (value === undefined || value === null) throw new NormalizeError(name, `Thiếu trường bắt buộc: ${name}`);
  return value;
}
function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return String(value).trim() || null;
}
export function parseAmountToDong(raw: unknown): bigint {
  if (typeof raw === 'bigint') return raw;
  const value = String(raw).trim();
  if (!/^-?\d+(\.\d+)?$/.test(value)) throw new NormalizeError('amount', `Số tiền không đọc được: ${value}`);
  const [integer, fraction] = value.split('.');
  if (fraction && /[1-9]/.test(fraction)) throw new NormalizeError('amount', `Số tiền có phần lẻ khác 0: ${value}`);
  return BigInt(integer);
}
export function parseVnDateTime(raw: unknown): Date {
  const value = String(raw).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new NormalizeError('transactionDate', `Thời gian không đọc được: ${value}`);
  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour - 7, minute, second));
  const local = new Date(date.getTime() + 7 * 3_600_000);
  if (local.getUTCFullYear() !== year || local.getUTCMonth() !== month - 1 || local.getUTCDate() !== day ||
      local.getUTCHours() !== hour || local.getUTCMinutes() !== minute || local.getUTCSeconds() !== second) {
    throw new NormalizeError('transactionDate', `Thời gian không hợp lệ: ${value}`);
  }
  return date;
}
export function normalizeSepay(body: Record<string, unknown>): CanonicalTransaction {
  const transferType = requireField(body, 'transferType');
  if (transferType !== 'in' && transferType !== 'out') throw new NormalizeError('transferType', `Giá trị transferType lạ: ${String(transferType)}`);
  const referenceCode = optionalString(body.referenceCode);
  const accumulated = body.accumulated;
  return {
    source: 'sepay', sourceEventId: String(requireField(body, 'id')),
    channel: referenceCode ? 'api' : 'sms', bankCode: String(requireField(body, 'gateway')),
    accountNumber: String(requireField(body, 'accountNumber')), subAccount: optionalString(body.subAccount),
    direction: transferType as Direction, amount: parseAmountToDong(requireField(body, 'transferAmount')),
    balanceAfter: accumulated === undefined || accumulated === null ? null : parseAmountToDong(accumulated),
    content: optionalString(body.content), paymentCode: optionalString(body.code), referenceCode,
    occurredAt: parseVnDateTime(requireField(body, 'transactionDate')),
  };
}
