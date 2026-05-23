import { Schema, model, Document } from "mongoose";

export interface IUser {
  fbId: string;
  name?: string;
  isBlocked: boolean;
  lastSeenAt: Date;
}

export interface UserDocument extends IUser, Document {}

const UserSchema = new Schema<UserDocument>(
  {
    fbId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    lastSeenAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const UserModel = model<UserDocument>("User", UserSchema);
