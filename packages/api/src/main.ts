import 'reflect-metadata';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableShutdownHooks();
  // Behind Railway's proxy: trust the first hop so req.ip and X-Forwarded-For
  // reflect the real client (used for rate-limit keys), not the proxy.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const config = app.get(ConfigService);
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(
    json({
      limit: config.get<string>('JSON_BODY_LIMIT', '8mb'),
      // Stash the raw bytes only for the Stripe webhook, which needs them to
      // verify the signature (the parsed JSON is not byte-identical).
      verify: (req: any, _res, buf) => {
        if (typeof req.url === 'string' && req.url.includes('/billing/stripe/webhook')) {
          req.rawBody = buf;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true, limit: config.get<string>('URLENCODED_BODY_LIMIT', '1mb') }));
  // Fail closed: only origins explicitly listed in CORS_ORIGINS are allowed.
  // Native mobile clients don't send an Origin header, so this does not affect
  // them; it only restricts browsers. Set CORS_ORIGINS for web/dev.
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
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
