const SCRIPT_PASSWORD = 'dream-card-agent::local-obfuscation::v1';
const ITERATIONS = 150_000;

export type EncryptedPayload = {
  algorithm: 'AES-GCM';
  ciphertext: string;
  iterations: number;
  iv: string;
  salt: string;
  version: 1;
};

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function deriveKey(salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SCRIPT_PASSWORD),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { hash: 'SHA-256', iterations, name: 'PBKDF2', salt: Uint8Array.from(salt).buffer },
    material,
    { length: 256, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt'],
  );
}

export async function encryptLocalPayload(value: unknown): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt, ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt({ iv, name: 'AES-GCM' }, key, plaintext);
  return {
    algorithm: 'AES-GCM',
    ciphertext: toBase64(new Uint8Array(ciphertext)),
    iterations: ITERATIONS,
    iv: toBase64(iv),
    salt: toBase64(salt),
    version: 1,
  };
}

export async function decryptLocalPayload<T>(payload: EncryptedPayload): Promise<T> {
  if (payload.version !== 1 || payload.algorithm !== 'AES-GCM') {
    throw new Error('不支持的API凭据加密格式。');
  }
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const key = await deriveKey(salt, payload.iterations);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { iv: Uint8Array.from(iv).buffer, name: 'AES-GCM' },
      key,
      Uint8Array.from(fromBase64(payload.ciphertext)).buffer,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new Error('API凭据无法解密，配置可能已经损坏。');
  }
}
