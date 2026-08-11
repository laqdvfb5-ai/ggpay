export type Channel = 'api' | 'sms' | 'unknown';
export type Direction = 'in' | 'out';

export interface CanonicalTransaction {
  source: 'sepay';
  sourceEventId: string;
  channel: Channel;
  bankCode: string;
  accountNumber: string;
  subAccount: string | null;
  direction: Direction;
  amount: bigint;
  balanceAfter: bigint | null;
  content: string | null;
  paymentCode: string | null;
  referenceCode: string | null;
  occurredAt: Date;
}
