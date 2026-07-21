import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { GoogleCalendarRuntimeService } from "./google-calendar-runtime.service";

@Controller()
export class RuntimeReadinessController {
  constructor(
    @Inject(GoogleCalendarRuntimeService)
    private readonly runtime: GoogleCalendarRuntimeService
  ) {}

  @Get("healthz")
  async health() {
    try {
      await this.runtime.assertReady();
      return {
        appId: this.runtime.config.manifest.app.id,
        appVersion: this.runtime.config.manifest.app.version,
        status: "ok"
      };
    } catch {
      throw new ServiceUnavailableException({ status: "unavailable" });
    }
  }
}
