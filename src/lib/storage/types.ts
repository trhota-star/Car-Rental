// Provider-neutral file storage contract. Swap the local folder for cloud
// object storage via STORAGE_DRIVER without touching app code.

export interface StoredFile {
  key: string;
  size: number;
  contentType: string;
}

export interface FileStorage {
  readonly name: string;
  put(key: string, data: Uint8Array, contentType: string): Promise<StoredFile>;
  /** Returns null when the file does not exist. */
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}
