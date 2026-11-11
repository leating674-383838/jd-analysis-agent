// src/lib/fingerprint.ts
import FingerprintJS from '@fingerprintjs/fingerprintjs';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  cached = result.visitorId;
  return cached;
}