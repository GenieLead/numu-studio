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

class VercelBlobBucket implements Bucket {
  async get(key: string, options?: { range?: { offset: number; length: number } }): Promise<StoredObject | null> {
    try {
      const response = await fetch(key);
      if (!response.ok) return null;

      let body = response.body;
      if (options?.range && body) {
        const reader = body.getReader();
        const bytes = await reader.read();
        const sliced = new Uint8Array(bytes.value.buffer, options.range.offset, options.range.length);
        body = new ReadableStream({
          start(controller) {
            controller.enqueue(sliced);
            controller.close();
          },
        });
      }

      return {
        body: body!,
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
        httpMetadata: {
          contentType: info.contentType,
        },
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
    await del(key);
  }
}

export function getBucket(): Bucket {
  return new VercelBlobBucket();
}
