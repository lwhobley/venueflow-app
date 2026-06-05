import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { VenueScopedRequest } from './venue-scope.guard';

export const VenueScope = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<VenueScopedRequest>();
    return request.venueScope;
  },
);
