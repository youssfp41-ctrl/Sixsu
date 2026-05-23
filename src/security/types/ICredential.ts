export enum CredentialSource {
  ENV            = "ENV",
  ENCRYPTED_FILE = "ENCRYPTED_FILE",
  UNKNOWN        = "UNKNOWN",
}

export enum CredentialStatus {
  VALID     = "VALID",
  MISSING   = "MISSING",
  CORRUPTED = "CORRUPTED",
  EXPIRED   = "EXPIRED",
  HARDCODED = "HARDCODED",
}

export interface CredentialEntry {
  key:      string;
  value:    string;
  source:   CredentialSource;
  status:   CredentialStatus;
  loadedAt: Date;
}

export interface LoadResult {
  success:     boolean;
  credentials: CredentialEntry[];
  source:      CredentialSource;
  error?:      string;
}

export interface ICredentialLoader {
  readonly name: string;
  canLoad():     Promise<boolean>;
  load():        Promise<LoadResult>;
}
