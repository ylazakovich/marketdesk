import dotenv from 'dotenv';
import { readEmbeddedApplicationVersion } from './applicationVersion';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const runningInProduction = nodeEnv === 'production';

export type DatabaseSslMode = 'disable' | 'verify-full';

export function resolveDatabaseSslMode(
  value: string | undefined,
  isProd: boolean = runningInProduction,
): DatabaseSslMode {
  const mode = value?.trim();
  if (!mode) {
    if (isProd) {
      throw new Error(
        'DB_SSL_MODE must be set in production (use "disable" or "verify-full")',
      );
    }
    return 'disable';
  }
  if (mode !== 'disable' && mode !== 'verify-full') {
    throw new Error('DB_SSL_MODE must be either "disable" or "verify-full"');
  }
  return mode;
}

export function optionalPositiveInt(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }
  return parsed;
}

export function positiveInt(value: string | undefined, fallback: number, name: string): number {
  const parsed = optionalPositiveInt(value) ?? fallback;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseCategoryIds(value: string | undefined): Record<string, number> {
  if (!value?.trim()) return {};
  const decoded = JSON.parse(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(decoded).map(([key, raw]) => {
      if (!Number.isInteger(raw) || Number(raw) <= 0) {
        throw new Error(`Invalid OLX category id for ${key}`);
      }
      return [key.toLowerCase(), Number(raw)];
    }),
  );
}

// Resolve a JWT signing secret fail-closed. In production a missing secret, an
// empty secret, or a leftover `your_`-prefixed placeholder is fatal (throws at
// boot) so the app never signs tokens with a guessable key. Outside production
// a clearly-marked dev-only value is returned when unset so local/test boots
// stay frictionless. (S1)
export function resolveJwtSecret(
  value: string | undefined,
  name: string,
  isProd: boolean = runningInProduction,
): string {
  const isPlaceholder = value === undefined || value === '' || value.startsWith('your_');
  if (isProd) {
    if (isPlaceholder) {
      throw new Error(
        `${name} must be set to a strong, non-placeholder value in production`,
      );
    }
    return value;
  }
  return value && !isPlaceholder ? value : `dev-only-insecure-${name.toLowerCase()}`;
}

export const env = {
  // Application
  nodeEnv,
  appName: process.env.APP_NAME || 'hermes-marketdesk',
  applicationVersion: readEmbeddedApplicationVersion(),
  appPort: parseInt(process.env.APP_PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY === 'true',

  // Database
  database: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'marketdesk',
    password: process.env.DB_PASSWORD || 'marketdesk',
    name: process.env.DB_NAME || 'marketdesk',
    poolMin: parseInt(process.env.DB_POOL_MIN || '2', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '10', 10),
    sslMode: resolveDatabaseSslMode(process.env.DB_SSL_MODE),
  },

  // Redis
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || '',
  },

  // JWT — secrets resolved fail-closed (throws in production on a missing/placeholder value).
  jwt: {
    secret: resolveJwtSecret(process.env.JWT_SECRET, 'JWT_SECRET'),
    expiration: process.env.JWT_EXPIRATION || '24h',
    refreshSecret: resolveJwtSecret(process.env.JWT_REFRESH_SECRET, 'JWT_REFRESH_SECRET'),
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },

  // Hermes Integration
  hermes: {
    apiUrl: process.env.HERMES_API_URL || '',
    apiKey: process.env.HERMES_API_KEY || '',
    webhookSecret: process.env.HERMES_WEBHOOK_SECRET || '',
  },

  // External marketplaces
  marketplaces: {
    olx: {
      market: process.env.OLX_MARKET || 'PL',
      adapterMode: process.env.OLX_ADAPTER_MODE || 'stub',
      apiBaseUrl: process.env.OLX_API_BASE_URL || 'https://www.olx.pl/api/partner',
      authUrl: process.env.OLX_AUTH_URL || 'https://www.olx.pl/oauth/authorize',
      tokenUrl: process.env.OLX_TOKEN_URL || 'https://www.olx.pl/api/open/oauth/token',
      clientId: process.env.OLX_CLIENT_ID || '',
      clientSecret: process.env.OLX_CLIENT_SECRET || '',
      redirectUri: process.env.OLX_REDIRECT_URI || '',
      requiredScopes: process.env.OLX_REQUIRED_SCOPES || 'read write v2',
      oauthSuccessUrl:
        process.env.OLX_OAUTH_SUCCESS_URL || 'http://localhost:3000/marketplaces',
      accessToken: process.env.OLX_ACCESS_TOKEN || '',
      refreshToken: process.env.OLX_REFRESH_TOKEN || '',
      livePublishEnabled: process.env.OLX_LIVE_PUBLISH_ENABLED === 'true',
      requestTimeoutMs: parseInt(process.env.OLX_REQUEST_TIMEOUT_MS || '30000', 10),
      categoryIds: parseCategoryIds(process.env.OLX_CATEGORY_IDS_JSON),
      defaultCategoryId: optionalPositiveInt(process.env.OLX_DEFAULT_CATEGORY_ID),
      cityId: optionalPositiveInt(process.env.OLX_CITY_ID),
      districtId: optionalPositiveInt(process.env.OLX_DISTRICT_ID),
      contactName: process.env.OLX_CONTACT_NAME || '',
      contactPhone: process.env.OLX_CONTACT_PHONE || '',
      advertiserType:
        process.env.OLX_ADVERTISER_TYPE === 'business' ? ('business' as const) : ('private' as const),
      priceNegotiable: process.env.OLX_PRICE_NEGOTIABLE === 'true',
      conditionAttributeCode: process.env.OLX_CONDITION_ATTRIBUTE_CODE || '',
      deliveryAttributeCode: process.env.OLX_DELIVERY_ATTRIBUTE_CODE || '',
      deliveryOptionCode: process.env.OLX_DELIVERY_OPTION_CODE || '',
    },
  },

  marketplaceCredentialsKey: process.env.MARKETPLACE_CREDENTIALS_KEY || '',

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || '15', 10) * 60 * 1000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  // File Upload
  upload: {
    maxFileSize: positiveInt(process.env.MAX_FILE_SIZE, 52_428_800, 'MAX_FILE_SIZE'),
    maxWorkspaceBytes: positiveInt(
      process.env.MAX_UPLOAD_WORKSPACE_BYTES,
      1_073_741_824,
      'MAX_UPLOAD_WORKSPACE_BYTES',
    ),
    maxWorkspaceFiles: positiveInt(
      process.env.MAX_UPLOAD_WORKSPACE_FILES,
      1_200,
      'MAX_UPLOAD_WORKSPACE_FILES',
    ),
    uploadDir: process.env.UPLOAD_DIR || './uploads',
  },

  // Timezone
  timezone: process.env.TIMEZONE || 'UTC',

  // Feature Flags
  features: {
    enableBulkOperations: process.env.ENABLE_BULK_OPERATIONS === 'true',
    enablePriceOptimization: process.env.ENABLE_PRICE_OPTIMIZATION === 'true',
    enableInventorySync: process.env.ENABLE_INVENTORY_SYNC === 'true',
  },
};

export const isProduction = runningInProduction;
export const isDevelopment = env.nodeEnv === 'development';
export const isTest = env.nodeEnv === 'test';
