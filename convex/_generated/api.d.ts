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
import type * as autoScheduleEngine from "../autoScheduleEngine.js";
import type * as barInventory from "../barInventory.js";
import type * as billing from "../billing.js";
import type * as billing_shared from "../billing/shared.js";
import type * as chat from "../chat.js";
import type * as cosmicInsights from "../cosmicInsights.js";
import type * as crons from "../crons.js";
import type * as floor from "../floor.js";
import type * as floorBinding from "../floorBinding.js";
import type * as guests from "../guests.js";
import type * as http from "../http.js";
import type * as invites from "../invites.js";
import type * as notifications from "../notifications.js";
import type * as operations from "../operations.js";
import type * as payroll from "../payroll.js";
import type * as pos from "../pos.js";
import type * as push from "../push.js";
import type * as reservationIntegrations from "../reservationIntegrations.js";
import type * as reservations from "../reservations.js";
import type * as scheduleEmails from "../scheduleEmails.js";
import type * as scheduling from "../scheduling.js";
import type * as secrets from "../secrets.js";
import type * as seed from "../seed.js";
import type * as staffAuth from "../staffAuth.js";
import type * as tables from "../tables.js";
import type * as webhookRateLimit from "../webhookRateLimit.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  app: typeof app;
  auth: typeof auth;
  authz: typeof authz;
  autoScheduleEngine: typeof autoScheduleEngine;
  barInventory: typeof barInventory;
  billing: typeof billing;
  "billing/shared": typeof billing_shared;
  chat: typeof chat;
  cosmicInsights: typeof cosmicInsights;
  crons: typeof crons;
  floor: typeof floor;
  floorBinding: typeof floorBinding;
  guests: typeof guests;
  http: typeof http;
  invites: typeof invites;
  notifications: typeof notifications;
  operations: typeof operations;
  payroll: typeof payroll;
  pos: typeof pos;
  push: typeof push;
  reservationIntegrations: typeof reservationIntegrations;
  reservations: typeof reservations;
  scheduleEmails: typeof scheduleEmails;
  scheduling: typeof scheduling;
  secrets: typeof secrets;
  seed: typeof seed;
  staffAuth: typeof staffAuth;
  tables: typeof tables;
  webhookRateLimit: typeof webhookRateLimit;
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
