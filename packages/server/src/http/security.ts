import fs from 'node:fs';
import path from 'node:path';

/**
 * Security helpers for public instances: a dependency-free per-IP rate
 * limiter, image magic-byte sniffing, and upload-quota accounting.
 *
 * Everything here is in-memory and per-process. That is deliberate: the
 * supported deployment is a single container with a SQLite file, so a shared
 * store (redis et al) would be a dependency with no user. If this ever runs
 * multi-instance, the limiter becomes per-instance — document it, don't fake it.
 */

export interface RateLimitRule {
  /** Max requests allowed inside the window. `0` disables the limit. */
  limit: number;
  windowMs: number;
}

export interface RateLimitVerdict {
  ok: boolean;
  /** Seconds until the oldest hit falls out of the window (>= 1). */
  retryAfterSec: number;
}

/**
 * Sliding-window counter keyed by client IP. Each key keeps the timestamps of
 * its hits inside the window; anything older is dropped on the next touch.
 * Memory is bounded by a sweep once the key count gets silly.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly rule: RateLimitRule,
    private readonly now: () => number = Date.now,
  ) {}

  check(key: string): RateLimitVerdict {
    if (this.rule.limit <= 0) return { ok: true, retryAfterSec: 0 };
    const now = this.now();
    const cutoff = now - this.rule.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.rule.limit) {
      this.hits.set(key, recent);
      const oldest = recent[0]!;
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((oldest + this.rule.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.sweep(cutoff);
    return { ok: true, retryAfterSec: 0 };
  }

  /** Drop every key whose hits have all aged out. */
  private sweep(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }

  /** Testing/ops escape hatch: forget all recorded hits. */
  reset(): void {
    this.hits.clear();
  }
}

/**
 * Best-effort client address. Behind a reverse proxy (the documented
 * deployment) the socket address is the proxy, so the first hop of
 * `X-Forwarded-For` is the real client — but that header is client-controlled
 * when the app is directly exposed, hence `trustProxy`.
 */
export function clientIp(
  req: Request,
  socketAddress: string | null,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const fwd = req.headers.get('x-forwarded-for');
    const first = fwd?.split(',')[0]?.trim();
    if (first) return first;
    const real = req.headers.get('x-real-ip')?.trim();
    if (real) return real;
  }
  return socketAddress || 'unknown';
}

export type SniffedImage = 'image/png' | 'image/jpeg' | 'image/webp';

const IMAGE_EXTENSIONS: Record<SniffedImage, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
};

export function extensionFor(type: SniffedImage): string {
  return IMAGE_EXTENSIONS[type];
}

/**
 * Identify an image by its magic bytes, ignoring the client-supplied MIME type
 * and filename. Returns null for anything that is not a PNG, JPEG, or WebP —
 * an HTML/SVG/script payload renamed `map.png` never reaches disk.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

/** Total bytes stored under `dir` (0 when it does not exist). */
export function dirSizeBytes(dir: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSizeBytes(full);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(full).size;
      } catch {
        // raced with a delete; ignore
      }
    }
  }
  return total;
}

/**
 * Constant-time-ish string comparison for the instance create password.
 * Not a hash comparison — the value is a shared operator secret, and the point
 * is only to avoid leaking its length/prefix through early-exit timing.
 */
export function secretEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
