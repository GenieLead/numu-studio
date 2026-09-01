import { put, del, head as blobHead } from "@vercel/blob";

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
};

function blobUrlFromKey(key: string): string {
  const storeId = process.env.BLOB_STORE_ID;
  if (!storeId) throw new Error("BLOB_STORE_ID is not configured.");
  return `https://${storeId}.blob.vercel-storage.com/${key}`;
}

class VercelBlobBucket implements Bucket {
  async get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredObject | null> {
    const url = blobUrlFromKey(key);
    try {
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
      const info = await blobHead(key);
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
      const url = blobUrlFromKey(key);
      await del(url);
    } catch { /* ignore */ }
  }
}

export function getBucket(): Bucket {
  return new VercelBlobBucket();
}
