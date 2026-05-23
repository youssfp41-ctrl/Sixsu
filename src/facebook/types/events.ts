interface FBBaseEvent {
  readonly senderId: string;
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

export interface FBUnknownEvent extends FBBaseEvent {
  readonly type: "unknown";
}

export type FBEvent = FBMessageEvent | FBPostbackEvent | FBUnknownEvent;
