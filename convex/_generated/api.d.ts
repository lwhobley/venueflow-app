/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as app from "../app.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as billing from "../billing.js";
import type * as billing_shared from "../billing/shared.js";
import type * as floor from "../floor.js";
import type * as floorBinding from "../floorBinding.js";
import type * as http from "../http.js";
import type * as notifications from "../notifications.js";
import type * as reservations from "../reservations.js";
import type * as seed from "../seed.js";
import type * as tables from "../tables.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  app: typeof app;
  auth: typeof auth;
  authz: typeof authz;
  billing: typeof billing;
  "billing/shared": typeof billing_shared;
  floor: typeof floor;
  floorBinding: typeof floorBinding;
  http: typeof http;
  notifications: typeof notifications;
  reservations: typeof reservations;
  seed: typeof seed;
  tables: typeof tables;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
