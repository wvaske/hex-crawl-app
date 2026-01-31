import { mkdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StorageBackend } from "./interface.js";

export class LocalStorageBackend implements StorageBackend {
  constructor(
    private basePath: string,
    private urlPrefix: string,
  ) {}

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const filePath = join(this.basePath, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data);
  }

  getUrl(key: string): string {
    return `${this.urlPrefix}/${key}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.basePath, key);
    try {
      await unlink(filePath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }
}
