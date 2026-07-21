import { Module } from "@nestjs/common";
import { GoogleCalendarRuntimeService } from "./runtime/google-calendar-runtime.service";
import { GoogleCalendarOAuthController } from "./runtime/oauth.controller";
import { RuntimeProtocolController } from "./runtime/protocol.controller";
import { RuntimeReadinessController } from "./runtime/readiness.controller";
import { RuntimeTrustController } from "./runtime/trust.controller";

@Module({
  controllers: [
    RuntimeProtocolController,
    GoogleCalendarOAuthController,
    RuntimeTrustController,
    RuntimeReadinessController
  ],
  providers: [GoogleCalendarRuntimeService]
})
export class AppModule {}
