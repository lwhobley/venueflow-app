import 'reflect-metadata';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get(ConfigService);
  const origins = config
    .get<string>('CORS_ORIGINS', '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(json({ limit: config.get<string>('JSON_BODY_LIMIT', '8mb') }));
  app.use(urlencoded({ extended: true, limit: config.get<string>('URLENCODED_BODY_LIMIT', '1mb') }));
  app.enableCors({
    origin: origins.length > 0 ? origins : config.get<string>('NODE_ENV') === 'production' ? false : true,
    credentials: true,
  });
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
