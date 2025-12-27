import * as crypto from 'crypto';

/**
 * Generates a content hash for version detection
 */
export function generateContentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Generates a timestamp-based version string
 */
export function generateTimestampVersion(contentHash: string): string {
  const now = new Date();
  const timestamp = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const shortHash = contentHash.substring(0, 8);
  return `${timestamp}-${shortHash}`;
}
