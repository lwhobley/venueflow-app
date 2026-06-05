import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AppController } from './modules/app/app.controller';
import { CompatibilityController } from './modules/compatibility/compatibility.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['packages/api/.env.local', 'packages/api/.env', '.env.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
  ],
  controllers: [HealthController, AppController, CompatibilityController],
})
export class AppModule {}
