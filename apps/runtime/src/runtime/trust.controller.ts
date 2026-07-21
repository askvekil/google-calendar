import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { GoogleCalendarRuntimeService } from "./google-calendar-runtime.service";

@Controller(".well-known")
export class RuntimeTrustController {
  constructor(
    @Inject(GoogleCalendarRuntimeService)
    private readonly runtime: GoogleCalendarRuntimeService
  ) {}

  @Get("jwks.json")
  getJwks(@Res({ passthrough: true }) response: Response) {
    response.setHeader("cache-control", "public, max-age=300");
    return this.runtime.getJwks();
  }
}
