import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const envelopeVersion = 1;

interface VaultEnvelope {
  ciphertext: string;
  iv: string;
  tag: string;
  version: typeof envelopeVersion;
}

export class RuntimeVault {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.byteLength !== 32) {
      throw new Error("runtime_vault_key_invalid");
    }

    this.key = Buffer.from(key);
  }

  encrypt(value: unknown, purpose: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(algorithm, this.key, iv);
    cipher.setAAD(Buffer.from(purpose, "utf8"));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    const envelope: VaultEnvelope = {
      ciphertext: ciphertext.toString("base64url"),
      iv: iv.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      version: envelopeVersion
    };
    return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url");
  }

  decrypt(value: string, purpose: string): unknown {
    const envelope = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as VaultEnvelope;

    if (envelope.version !== envelopeVersion) {
      throw new Error("runtime_vault_envelope_version_unsupported");
    }

    const decipher = createDecipheriv(algorithm, this.key, Buffer.from(envelope.iv, "base64url"));
    decipher.setAAD(Buffer.from(purpose, "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8")) as unknown;
  }
}
