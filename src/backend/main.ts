import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pino from 'pino';
import { env, isDevelopment, isTest } from './config/env.js';
import { createPool, closePool } from './config/database.js';
import { createRedisClient, closeRedis } from './config/redis.js';
import { buildApp } from './presentation/http/app.js';
import { HermesLiveUpdates } from './presentation/websocket/HermesLiveUpdates.js';
import { buildContainer, type AppContainer } from './config/di/index.js';

const logger = pino({
  level: env.logLevel,
  transport: isDevelopment ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  } : undefined
});

// Composition seam. The DI container (config/di) constructs the full object graph
// — repositories, infrastructure services, ports and application services — and
// returns an AppDeps-compatible container plus the WS event subscriber and the
// lifecycle handles needed for graceful shutdown.
function resolveContainer(): AppContainer {
  return buildContainer({ logger });
}

const startServer = async () => {
  try {
    const pool = createPool();
    logger.info('Database pool created');

    createRedisClient();
    logger.info('Redis client created');

    await pool.query('SELECT NOW()');
    logger.info('Database connection verified');

    let app: express.Express;
    let container: AppContainer | undefined;
    try {
      container = resolveContainer();
      app = buildApp(container.deps, {
        enableRateLimit: !isTest,
        corsOrigin: env.cors.origin,
      });
      logger.info('API layer mounted via buildApp(deps)');
    } catch (wiringError) {
      // In production a wiring failure is fatal — surface it and exit rather than
      // serving a crippled health-only process. In dev/test we degrade so the
      // process stays inspectable.
      if (env.nodeEnv === 'production') {
        logger.error({ err: wiringError }, 'Failed to wire application (fatal)');
        throw wiringError;
      }
      logger.warn(
        { err: wiringError },
        'API layer failed to wire; starting health-only server',
      );
      app = express();
      app.use(helmet());
      app.use(compression());
      app.use(cors({ origin: env.cors.origin, credentials: true }));
      app.use(express.json({ limit: '10mb' }));
    }

    // Health/readiness endpoints are owned by the process, not the API layer.
    // Rate-limit health checks to prevent DoS attacks on startup/shutdown probes.
    const healthLimiter = rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      skip: () => isTest,
    });

    app.get('/health', healthLimiter, (_req, res) => {
      res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: env.nodeEnv,
      });
    });

    app.get('/ready', healthLimiter, async (_req, res) => {
      try {
        const p = createPool();
        await p.query('SELECT NOW()');
        const r = createRedisClient();
        await r.ping();
        res.status(200).json({
          status: 'ready',
          database: 'connected',
          redis: 'connected',
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ error }, 'Readiness check failed');
        res.status(503).json({
          status: 'not_ready',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });

    // Serve the built frontend (single-service deployment) when a production build
    // exists at dist/frontend. Registered AFTER the /api router + its 404 handler so
    // API requests are never shadowed; skipped in dev where Vite serves the SPA on
    // :5173. The catch-all returns index.html for client-side routes (SPA fallback),
    // excluding /api, /health and /ready which are handled above.
    const frontendDir = path.resolve(process.cwd(), 'dist/frontend');
    const indexHtml = path.join(frontendDir, 'index.html');
    if (fs.existsSync(indexHtml)) {
      // Rate limit SPA fallback to prevent file system exhaustion
      const spaLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 60,
        skip: () => isTest,
      });
      app.use(express.static(frontendDir));
      app.get('*', spaLimiter, (req, res, next) => {
        if (
          req.path.startsWith('/api') ||
          req.path === '/health' ||
          req.path === '/ready'
        ) {
          return next();
        }
        res.sendFile(indexHtml);
      });
      logger.info({ frontendDir }, 'Serving built frontend (SPA) from backend');
    } else {
      logger.info('No built frontend found (dist/frontend); serving API only');
    }

    const server = http.createServer(app);

    // Mount the Hermes live-updates WebSocket server, feeding it the container's
    // IEventSubscriber (the event broker's in-process fan-out) so published domain
    // events reach subscribed clients. Without a container (degraded mode) it still
    // accepts clients and can be fed via broadcast().
    const hermesLive = new HermesLiveUpdates(
      container ? { subscriber: container.subscriber } : {},
    );
    hermesLive.attach(server);
    logger.info('Hermes live WebSocket attached at /api/hermes/live');

    server.listen(env.appPort, () => {
      logger.info(
        { port: env.appPort, environment: env.nodeEnv },
        `${env.appName} server started`,
      );
    });

    // The entry point owns ALL process signal handling and the single ordered
    // graceful-shutdown path. Config modules (config/redis, config/database)
    // must not register signal handlers or call process.exit — otherwise a
    // config-side handler could exit the process before this sequence finishes.
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received, starting graceful shutdown`);
      await hermesLive.close();
      if (container) {
        // Closes the Bull queues, Redis client and pg pool.
        await container.shutdown();
      } else {
        // Degraded mode: no container owns the shared singletons, so close them
        // here as part of the ordered shutdown.
        await closeRedis();
        await closePool();
      }
      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();
