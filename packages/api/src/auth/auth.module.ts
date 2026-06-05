import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        const convexSiteUrl = config.get<string>('CONVEX_SITE_URL');
        // JWT_SECRET is required unless CONVEX_SITE_URL is set (RS256/JWKS path).
        if (!secret && !convexSiteUrl) {
          throw new Error('JWT_SECRET or CONVEX_SITE_URL environment variable is required');
        }
        return { secret: secret ?? 'unused-rs256-verification-handled-by-jwks' };
      },
    }),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard, JwtModule],
})
export class AuthModule {}
