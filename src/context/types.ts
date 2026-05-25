import type { UserRole, UserPreferences } from "../users/types/IUserService";

export interface ContextUser {
  readonly id:           string;
  readonly name?:        string;

  // ── Profile (populated by UserService when DB is available) ─────────────
  /** Access role — defaults to "user" when DB is unavailable. */
  readonly role:         UserRole;
  /** Total number of messages sent by this user to the bot. */
  readonly messageCount: number;
  /** When this user last sent a message (or now if unknown). */
  readonly lastSeen:     Date;
  /** When this user first interacted with the bot. */
  readonly createdAt:    Date;
  /** Key/value user preferences. */
  readonly preferences:  UserPreferences;
  /** True only on the very first message from this user. */
  readonly isNew:        boolean;
}

export interface ContextThread {
  readonly id:     string;
  readonly pageId: string;
}

export interface ContextAttachment {
  readonly type:         "image" | "video" | "audio" | "file" | "location";
  readonly url?:         string;
  readonly coordinates?: { lat: number; long: number };
}

export interface ContextMessage {
  readonly id:               string;
  readonly text?:            string;
  readonly attachments:      ContextAttachment[];
  readonly timestamp:        number;
  readonly isPostback:       boolean;
  readonly postbackPayload?: string;
}
