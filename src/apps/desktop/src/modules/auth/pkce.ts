const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function randomString(length: number): string {
  const random = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(random)
    .map((n) => CHARS[n % CHARS.length])
    .join("");
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function generateCodeVerifier(): string {
  return randomString(96);
}

export async function generateCodeChallenge(codeVerifier: string): Promise<string> {
  const digest = await sha256(codeVerifier);
  return toBase64Url(digest);
}

export function generateState(): string {
  return randomString(48);
}

export function generateNonce(): string {
  return randomString(48);
}
