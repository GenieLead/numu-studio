import { put, del, head as blobHead, list } from "@vercel/blob";

type StoredObject = {
  body: ReadableStream;
  httpEtag?: string;
  size?: number;
  httpMetadata?: { contentType?: string };
};

type StoredObjectHead = Omit<StoredObject, "body">;

type Bucket = {
  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredObject | null>;
  head(key: string): Promise<StoredObjectHead | null>;
  put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
  listByPrefix(prefix: string): Promise<Array<{ key: string; url: string; size: number }>>;
};

class VercelBlobBucket implements Bucket {
  async get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredObject | null> {
    try {
      let url: string;
      if (key.startsWith("http://") || key.startsWith("https://")) {
        url = key;
      } else {
        const storeId = process.env.BLOB_STORE_ID;
        if (!storeId) return null;
        url = `https://${storeId}.blob.vercel-storage.com/${key}`;
      }

      const headers: Record<string, string> = {};
      if (options?.range) {
        headers["Range"] = `bytes=${options.range.offset}-${options.range.offset + options.range.length - 1}`;
      }
      const response = await fetch(url, { headers });
      if (!response.ok && response.status !== 206) return null;

      return {
        body: response.body!,
        httpEtag: response.headers.get("etag") ?? undefined,
        size: parseInt(response.headers.get("content-length") ?? "0", 10) || undefined,
        httpMetadata: {
          contentType: response.headers.get("content-type") ?? undefined,
        },
      };
    } catch {
      return null;
    }
  }

  async head(key: string): Promise<StoredObjectHead | null> {
    try {
      const url = (key.startsWith("http://") || key.startsWith("https://")) ? key : (() => {
        const storeId = process.env.BLOB_STORE_ID;
        return storeId ? `https://${storeId}.blob.vercel-storage.com/${key}` : null;
      })();
      if (!url) return null;
      const info = await blobHead(url);
      return {
        httpEtag: info.url,
        size: info.size,
        httpMetadata: { contentType: info.contentType },
      };
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    const blob = await put(key, value, {
      access: "private",
      contentType: options?.httpMetadata?.contentType,
    });
    return blob;
  }

  async delete(key: string): Promise<void> {
    try {
      if (key.startsWith("http://") || key.startsWith("https://")) {
        await del(key);
      } else {
        const storeId = process.env.BLOB_STORE_ID;
        if (storeId) {
          await del(`https://${storeId}.blob.vercel-storage.com/${key}`);
        }
      }
    } catch { /* ignore */ }
  }

  async listByPrefix(prefix: string): Promise<Array<{ key: string; url: string; size: number }>> {
    try {
      const result = await list({ prefix, limit: 200 });
      return result.blobs.map((blob) => ({
        key: blob.pathname,
        url: blob.url,
        size: blob.size,
      }));
    } catch {
      return [];
    }
  }
}

export function getBucket(): Bucket {
  return new VercelBlobBucket();
}
