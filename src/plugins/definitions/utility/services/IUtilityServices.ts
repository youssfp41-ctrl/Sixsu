import { ICommand } from "../../../../commands/types/ICommand";

/** Central service-name registry — prevents magic strings. */
export const SERVICES = {
  /** CommandRegistry — registered by bootstrap for help command. */
  COMMAND_REGISTRY:  "command-registry",
  /** Facebook Page Access Token string — registered by bootstrap. */
  FB_ACCESS_TOKEN:   "fb-access-token",
  /** FacebookClient instance — registered by bootstrap for image sending. */
  FACEBOOK_CLIENT:   "facebook-client",
  /** ResponseBuilder — provided by utility plugin for other plugins. */
  RESPONSE_BUILDER:  "response-builder",
  /** FacebookProfileService — internal, provided by utility plugin on enable. */
  FB_PROFILE:        "fb-profile-service",
} as const;

// ── Consumed services (provided by bootstrap / core) ─────────────────────────

/**
 * Minimal interface over CommandRegistry consumed by the help command.
 * CommandRegistry satisfies this via structural typing.
 */
export interface ICommandLookup {
  resolve(nameOrAlias: string): ICommand | undefined;
  byCategory(): Map<string, ICommand[]>;
  getAll(): ICommand[];
  size(): number;
}

/** Facebook user profile data from the Graph API. */
export interface FacebookProfile {
  id:          string;
  name:        string;
  profilePic?: string;
}

/** Service for fetching a Messenger user's profile from the Graph API. */
export interface IFacebookProfileService {
  getProfile(userId: string): Promise<FacebookProfile>;
}

// ── Provided services (exposed by utility plugin) ─────────────────────────────

/**
 * Shared response formatter provided to all plugins as "response-builder".
 * Other plugins can consume this to build consistent replies.
 */
export interface IResponseBuilder {
  /** Titled success block with an optional list of detail lines. */
  success(title: string, lines?: string[]): string;
  /** Warning / error line. */
  warn(message: string): string;
  /** Plain info block (no title). */
  info(lines: string[]): string;
  /** Horizontal separator. */
  sep(): string;
}
