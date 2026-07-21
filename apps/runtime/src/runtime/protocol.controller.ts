import { Controller, Get, Inject, Post, Req, Res, type RawBodyRequest } from "@nestjs/common";
import { appRemoteRuntimePaths } from "@vekil/app-sdk";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { GoogleCalendarRuntimeService } from "./google-calendar-runtime.service";

@Controller()
export class RuntimeProtocolController {
  constructor(
    @Inject(GoogleCalendarRuntimeService)
    private readonly runtime: GoogleCalendarRuntimeService
  ) {}

  @Post(appRemoteRuntimePaths.prepareInstallation)
  prepareInstallation(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  @Post(appRemoteRuntimePaths.completeInstallation)
  completeInstallation(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  @Post(appRemoteRuntimePaths.disconnectInstallation)
  disconnectInstallation(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  @Post(appRemoteRuntimePaths.planAction)
  planAction(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  @Post(appRemoteRuntimePaths.executeAction)
  executeAction(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  @Get(appRemoteRuntimePaths.health)
  health(
    @Req() request: RawBodyRequest<ExpressRequest>,
    @Res() response: ExpressResponse
  ): Promise<void> {
    return this.dispatch(request, response);
  }

  private async dispatch(
    request: RawBodyRequest<ExpressRequest>,
    response: ExpressResponse
  ): Promise<void> {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
      } else if (value !== undefined) {
        headers.set(name, value);
      }
    }

    const method = request.method === "GET" ? "GET" : "POST";
    const result = await this.runtime.handleProtocolRequest(
      new Request(new URL(request.originalUrl, this.runtime.config.baseUrl), {
        body: method === "GET" ? undefined : (request.rawBody?.toString("utf8") ?? ""),
        headers,
        method
      })
    );

    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.status(result.status).send(await result.text());
  }
}
