import 'reflect-metadata';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

const DEFAULT_CORS_ORIGINS = [
  'https://www.venuewrangler.com',
  'https://venuewrangler.com',
];

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  // Behind Railway's proxy: trust the first hop so req.ip and X-Forwarded-For
  // reflect the real client (used for rate-limit keys), not the proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const config = app.get(ConfigService);
  const isValidOrigin = (o: string) => /^https?:\/\//i.test(o) || o === '*';
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin && isValidOrigin(origin));
  const allowedOrigins = Array.from(new Set([...DEFAULT_CORS_ORIGINS, ...origins]));

  app.use(helmet());
  const STRIPE_WEBHOOK_PATH = '/api/v1/billing/stripe/webhook';
  app.use((req: Request, res: Response, next: NextFunction) => {
    const url = req.originalUrl ?? req.url ?? '';
    const path = url.split('?')[0].replace(/\/+$/, '');
    const limit = path === '/api/v1/chat/images' ? config.get<string>('JSON_BODY_LIMIT', '8mb') : '1mb';
    json({
      limit,
      verify: (req: Request & { rawBody?: Buffer }, _res, buf) => {
        const urlInner = req.originalUrl ?? req.url ?? '';
        const pathInner = urlInner.split('?')[0].replace(/\/+$/, '');
        if (pathInner === STRIPE_WEBHOOK_PATH) {
          req.rawBody = buf;
        }
      },
    })(req, res, next);
  });
  app.use(urlencoded({ extended: true, limit: config.get<string>('URLENCODED_BODY_LIMIT', '1mb') }));
  // Fail closed: only origins explicitly listed in CORS_ORIGINS are allowed.
  // Native mobile clients don't send an Origin header, so this does not affect
  // them; it only restricts browsers. Set CORS_ORIGINS for web/dev.
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const port = config.get<number>('PORT') ?? config.get<number>('API_PORT', 4000);
  await app.listen(port);
}

void bootstrap();
