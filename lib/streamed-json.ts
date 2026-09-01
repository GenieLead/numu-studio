const HEARTBEAT_MS = 2_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

/**
 * Streams JSON responses with heartbeat chunks to keep connections alive
 * during long AI operations. The final non-whitespace bytes are one JSON document.
 */
export function streamedJsonTask<T>(
  task: () => Promise<T>,
  headers: Record<string, string> = {},
): Response {
  const encoder = new TextEncoder();
  const settled = task().then(
    (value) => ({ value }),
    (error) => ({ error: errorMessage(error) }),
  );

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (value: string) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(value));
        } catch {
          cancelled = true;
          if (heartbeat) clearInterval(heartbeat);
        }
      };

      write("\n");
      heartbeat = setInterval(() => write(" \n"), HEARTBEAT_MS);
      void settled.then((result) => {
        if (heartbeat) clearInterval(heartbeat);
        write(JSON.stringify("value" in result ? result.value : { error: result.error }));
        if (!cancelled) controller.close();
      });
    },
    cancel() {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
      ...headers,
    },
  });
}
