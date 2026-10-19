/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as clarify from "../clarify.js";
import type * as clarifyData from "../clarifyData.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as guard from "../guard.js";
import type * as lib from "../lib.js";
import type * as model from "../model.js";
import type * as parent from "../parent.js";
import type * as seed from "../seed.js";
import type * as seedData from "../seedData.js";
import type * as site from "../site.js";
import type * as stats from "../stats.js";
import type * as summary from "../summary.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  clarify: typeof clarify;
  clarifyData: typeof clarifyData;
  crons: typeof crons;
  drafts: typeof drafts;
  guard: typeof guard;
  lib: typeof lib;
  model: typeof model;
  parent: typeof parent;
  seed: typeof seed;
  seedData: typeof seedData;
  site: typeof site;
  stats: typeof stats;
  summary: typeof summary;
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
