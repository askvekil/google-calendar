import { createHash } from "node:crypto";
import type { AppSignatureReplayClaim, AppSignatureReplayStore } from "@vekil/app-sdk/runtime";
import type { RuntimePrismaClient } from "./prisma-client";

export class PrismaRuntimeSignatureReplayStore implements AppSignatureReplayStore {
  private readonly prisma: RuntimePrismaClient;

  constructor(prisma: RuntimePrismaClient) {
    this.prisma = prisma;
  }

  async claim(input: AppSignatureReplayClaim): Promise<boolean> {
    const nonceHash = digest(input.nonce);
    const replayKey = digest([input.issuer, input.audience, input.keyId, nonceHash].join("\u0000"));

    try {
      await this.prisma.runtimeSignatureReplay.create({
        data: {
          replay_key: replayKey,
          issuer: input.issuer,
          audience: input.audience,
          key_id: input.keyId,
          nonce_hash: nonceHash,
          expires_at: input.expiresAt
        }
      });
      return true;
    } catch (error) {
      if (isPrismaUniqueConflict(error)) {
        return false;
      }

      throw error;
    }
  }
}

function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
