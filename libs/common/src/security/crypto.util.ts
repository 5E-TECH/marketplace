import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * Provider/partner secret'larini bazada shifrlangan holda saqlash uchun AES-256-GCM.
 * Kalit — INTEGRATION_CREDENTIAL_SECRET (env). Format: iv:authTag:ciphertext (hex).
 */
const ALGO = 'aes-256-gcm';

function keyFrom(secret: string): Buffer {
  // Har qanday uzunlikdagi secret'dan 32 baytli kalit
  return createHash('sha256').update(secret).digest();
}

export function encryptSecret(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFrom(secret), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload: string, secret: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(':');
  const decipher = createDecipheriv(
    ALGO,
    keyFrom(secret),
    Buffer.from(ivHex, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return dec.toString('utf8');
}
