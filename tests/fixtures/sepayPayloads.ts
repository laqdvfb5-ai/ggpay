export const sepayApiPayload = {
  id: 123456,
  gateway: 'MBBank',
  transactionDate: '2024-05-25 21:11:02',
  accountNumber: '0359123456',
  subAccount: null,
  code: null,
  content: 'Thanh toan QR SE123456',
  description: 'Thanh toan QR SE123456',
  transferType: 'in',
  transferAmount: 1700000,
  referenceCode: 'FT123456789',
  accumulated: 0,
};

export const sepaySmsPayload = {
  ...sepayApiPayload,
  id: 123457,
  gateway: 'Agribank',
  referenceCode: null,
  accumulated: 5000000,
};
