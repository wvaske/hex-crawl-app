export interface StorageBackend {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  getUrl(key: string): string;
  delete(key: string): Promise<void>;
}
