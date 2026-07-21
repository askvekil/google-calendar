import { Controller, Get, Inject, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { GoogleCalendarRuntimeService } from "./google-calendar-runtime.service";

@Controller("oauth/google")
export class GoogleCalendarOAuthController {
  constructor(
    @Inject(GoogleCalendarRuntimeService)
    private readonly runtime: GoogleCalendarRuntimeService
  ) {}

  @Get("callback")
  async callback(
    @Query("code") code: unknown,
    @Query("error") providerError: unknown,
    @Query("state") state: unknown,
    @Res() response: Response
  ): Promise<void> {
    try {
      const returnUrl = await this.runtime.completeOAuthCallback({
        ...(typeof code === "string" ? { code } : {}),
        ...(typeof providerError === "string" ? { providerError } : {}),
        ...(typeof state === "string" ? { state } : {})
      });
      response.redirect(303, returnUrl.toString());
    } catch {
      response.status(400).json({ error: "google_calendar_oauth_callback_invalid" });
    }
  }
}
