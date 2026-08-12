import 'dotenv/config';

export interface Config {
  port: number;
  databaseUrl: string;
  sepayWebhookToken: string;
  inspectToken: string;
  outboundUrl: string;
  outboundSecret: string;
  webhookEncryptionKey: string;
  sepayOauthClientId: string;
  sepayOauthClientSecret: string;
  sepayOauthRedirectUri: string;
  publicBaseUrl: string;
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
    webhookEncryptionKey: env.WEBHOOK_ENCRYPTION_KEY ?? '',
    sepayOauthClientId: env.SEPAY_OAUTH_CLIENT_ID ?? '',
    sepayOauthClientSecret: env.SEPAY_OAUTH_CLIENT_SECRET ?? '',
    sepayOauthRedirectUri: env.SEPAY_OAUTH_REDIRECT_URI ?? '',
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? '').replace(/\/$/, ''),
  };
}
