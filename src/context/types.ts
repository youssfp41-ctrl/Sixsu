export interface ContextUser {
  readonly id: string;
  readonly name?: string;
}

export interface ContextThread {
  readonly id: string;
  readonly pageId: string;
}

export interface ContextAttachment {
  readonly type: "image" | "video" | "audio" | "file" | "location";
  readonly url?: string;
  readonly coordinates?: { lat: number; long: number };
}

export interface ContextMessage {
  readonly id: string;
  readonly text?: string;
  readonly attachments: ContextAttachment[];
  readonly timestamp: number;
  readonly isPostback: boolean;
  readonly postbackPayload?: string;
}
