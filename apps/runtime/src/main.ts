import "reflect-metadata";

import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { loadRuntimeEnvironment } from "./config/load-environment";
import { GoogleCalendarRuntimeService } from "./runtime/google-calendar-runtime.service";

async function bootstrap(): Promise<void> {
  loadRuntimeEnvironment();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true
  });
  const runtime = app.get(GoogleCalendarRuntimeService);

  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.enableShutdownHooks();
  await app.listen(runtime.config.port);
}

void bootstrap();
