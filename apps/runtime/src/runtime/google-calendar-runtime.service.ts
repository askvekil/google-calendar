import { Injectable, type OnApplicationShutdown } from "@nestjs/common";
import type { AppJwks } from "@vekil/app-sdk";
import { createRemoteAppRuntime, type RemoteAppRuntime } from "@vekil/app-sdk/runtime";
import {
  GoogleCalendarConnectionService,
  GoogleCalendarHttpOAuthClient,
  GoogleCalendarHttpProvider,
  createGoogleCalendarRuntimeHandlers
} from "@vekil/google-calendar-app";
import {
  readGoogleCalendarRuntimeConfig,
  type GoogleCalendarRuntimeConfig
} from "../config/runtime-config";
import { PrismaGoogleCalendarConnectionStore } from "../storage/connection-store";
import { createRuntimePrismaClient, type RuntimePrismaClient } from "../storage/prisma-client";
import { PrismaRuntimeSignatureReplayStore } from "../storage/replay-store";
import { RuntimeVault } from "../storage/runtime-vault";

@Injectable()
export class GoogleCalendarRuntimeService implements OnApplicationShutdown {
  readonly config: GoogleCalendarRuntimeConfig;

  private readonly connection: GoogleCalendarConnectionService;
  private readonly prisma: RuntimePrismaClient;
  private readonly protocolRuntime: RemoteAppRuntime;

  constructor() {
    this.config = readGoogleCalendarRuntimeConfig();
    this.prisma = createRuntimePrismaClient(this.config.databaseUrl);
    const store = new PrismaGoogleCalendarConnectionStore(
      this.prisma,
      new RuntimeVault(this.config.vaultKey)
    );
    this.connection = new GoogleCalendarConnectionService({
      config: {
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        oauthCallbackUrl: this.config.oauthCallbackUrl
      },
      oauth: new GoogleCalendarHttpOAuthClient(),
      store
    });
    this.protocolRuntime = createRemoteAppRuntime({
      handlers: createGoogleCalendarRuntimeHandlers({
        connection: this.connection,
        manifest: this.config.manifest,
        provider: new GoogleCalendarHttpProvider()
      }),
      manifest: this.config.manifest,
      platformIssuer: this.config.platformIssuer,
      platformJwksUrl: this.config.platformJwksUrl,
      replayStore: new PrismaRuntimeSignatureReplayStore(this.prisma),
      signingIdentity: this.config.signingIdentity
    });
  }

  handleProtocolRequest(request: Request): Promise<Response> {
    return this.protocolRuntime.handle(request);
  }

  completeOAuthCallback(input: {
    code?: string;
    providerError?: string;
    state?: string;
  }): Promise<URL> {
    return this.connection.completeOAuthCallback(input);
  }

  getJwks(): AppJwks {
    return this.protocolRuntime.getJwks();
  }

  async assertReady(): Promise<void> {
    await this.prisma.$queryRawUnsafe("SELECT 1");
  }

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
