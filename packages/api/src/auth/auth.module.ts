import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        // Only a symmetric secret is configured here, so algorithm confusion
        // isn't exploitable today — but pin it explicitly as defense in depth
        // against a future change that adds an asymmetric verification path.
        return {
          secret,
          signOptions: { expiresIn: '30d', algorithm: 'HS256' },
          verifyOptions: { algorithms: ['HS256'] },
        };
      },
    }),
  ],
  providers: [AuthGuard, AuthService],
  exports: [AuthGuard, JwtModule, AuthService],
})
export class AuthModule {}
