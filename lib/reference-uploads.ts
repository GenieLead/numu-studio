export const REFERENCE_CHUNK_BYTES = 1024 * 1024;
export const MAX_REFERENCE_PARTS = 25;
export const REFERENCE_UPLOAD_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export function referencePartKey(ownerEmail: string, uploadId: string, partIndex: number): string {
  return `reference-parts/${ownerEmail}/${uploadId}/${partIndex}`;
}
