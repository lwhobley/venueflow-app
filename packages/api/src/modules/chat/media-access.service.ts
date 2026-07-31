import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

type MediaKind = 'chat-image' | 'checklist-photo';

type MediaAccessClaims = {
  purpose: 'media-access';
  kind: MediaKind;
  mediaId: string;
  venueId: string;
};

@Injectable()
export class MediaAccessService {
  constructor(private readonly jwt: JwtService) {}

  async createPath(kind: MediaKind, mediaId: string, venueId: string, path: string): Promise<string> {
    const token = await this.jwt.signAsync<MediaAccessClaims>(
      { purpose: 'media-access', kind, mediaId, venueId },
      // Short-lived: this token is the only gate on an otherwise-public image
      // route (React Native <Image> can't send a bearer header). 15 minutes
      // comfortably covers a single viewing session while limiting exposure
      // if the URL leaks (logs, screenshots, shared links).
      { expiresIn: '15m' },
    );
    return `${path}?token=${encodeURIComponent(token)}`;
  }

  async assertToken(token: string | undefined, kind: MediaKind, mediaId: string, venueId: string): Promise<void> {
    if (!token) throw new UnauthorizedException('Media access token is required');
    try {
      const claims = await this.jwt.verifyAsync<MediaAccessClaims>(token);
      if (
        claims.purpose !== 'media-access' ||
        claims.kind !== kind ||
        claims.mediaId !== mediaId ||
        claims.venueId !== venueId
      ) {
        throw new Error('Media token does not match this resource');
      }
    } catch {
      throw new UnauthorizedException('Media access token is invalid or expired');
    }
  }
}
