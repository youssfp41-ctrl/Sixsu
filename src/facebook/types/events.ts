interface FBBaseEvent {
  readonly senderId: string;
  /** Real Facebook user ID. In group chats via FCA, senderId carries the
   *  threadID for reply routing while senderFbId is the actual user. */
  readonly senderFbId?: string;
  readonly pageId: string;
  readonly timestamp: number;
}

export interface FBAttachment {
  readonly type: "image" | "video" | "audio" | "file" | "location";
  readonly url?: string;
  readonly coordinates?: { lat: number; long: number };
}

export interface FBMessageEvent extends FBBaseEvent {
  readonly type: "message";
  readonly messageId: string;
  readonly text?: string;
  readonly attachments: FBAttachment[];
}

export interface FBPostbackEvent extends FBBaseEvent {
  readonly type: "postback";
  readonly payload: string;
  readonly title: string;
}

export interface FBMemberJoinedEvent extends FBBaseEvent {
  readonly type: "member_joined";
  readonly addedByUserId: string;
  readonly members: string[];
}

export interface FBMemberLeftEvent extends FBBaseEvent {
  readonly type: "member_left";
  readonly members: string[];
}

export interface FBUnknownEvent extends FBBaseEvent {
  readonly type: "unknown";
}

export type FBEvent =
  | FBMessageEvent
  | FBPostbackEvent
  | FBMemberJoinedEvent
  | FBMemberLeftEvent
  | FBUnknownEvent;

