import 'dotenv/config';

export interface Config {
  port: number;
  databaseUrl: string;
  sepayWebhookToken: string;
  inspectToken: string;
  outboundUrl: string;
  outboundSecret: string;
}

type Env = Record<string, string | undefined>;
function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  return value;
}

export function loadConfig(env: Env = process.env): Config {
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT không hợp lệ');
  const databaseUrl = env.DATABASE_URL_TEST ?? env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Thiếu biến môi trường bắt buộc: DATABASE_URL');
  return {
    port,
    databaseUrl,
    sepayWebhookToken: required(env, 'SEPAY_WEBHOOK_TOKEN'),
    inspectToken: required(env, 'INSPECT_TOKEN'),
    outboundUrl: env.OUTBOUND_WEBHOOK_URL ?? '',
    outboundSecret: env.OUTBOUND_WEBHOOK_SECRET ?? '',
  };
}
