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
      { expiresIn: '1h' },
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
