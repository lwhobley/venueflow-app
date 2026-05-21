import { httpRouter } from 'convex/server';
import { auth } from './auth';

const http = httpRouter();

// Registers the Convex Auth HTTP routes (used by the auth flows).
auth.addHttpRoutes(http);

export default http;
