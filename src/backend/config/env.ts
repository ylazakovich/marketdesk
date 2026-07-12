import dotenv from 'dotenv';

dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const runningInProduction = nodeEnv === 'production';

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
  appPort: parseInt(process.env.APP_PORT || '3000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',

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
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10),
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
