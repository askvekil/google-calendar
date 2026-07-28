import {
  AppRuntimeHealthStatus,
  appProtocolVersion,
  createAppRuntimeBindings,
  type AppManifest,
  type AppRuntimeHealthResponse,
  type AppRuntimeV1Handlers
} from "@vekil/app-sdk/runtime";
import type { GoogleCalendarProvider } from "../provider/calendar-client";
import type { GoogleCalendarConnectionService } from "./connection-service";
import { executeGoogleCalendarAction } from "./executor";
import { planGoogleCalendarAction } from "./planner";

export function createGoogleCalendarRuntimeHandlers({
  connection,
  manifest,
  now = () => new Date(),
  provider
}: {
  connection: GoogleCalendarConnectionService;
  manifest: AppManifest;
  now?: () => Date;
  provider: GoogleCalendarProvider;
}): AppRuntimeV1Handlers {
  const bindings = createAppRuntimeBindings(manifest);

  return {
    prepareInstallation: (request) => connection.prepareInstallation(request),
    completeInstallation: (request) => connection.completeInstallation(request),
    disconnectInstallation: (request) => connection.disconnectInstallation(request),
    planAction: async (request) => planGoogleCalendarAction(request, bindings),
    executeAction: (request) =>
      executeGoogleCalendarAction(request, {
        bindings,
        credentials: connection,
        provider
      }),
    health: async (): Promise<AppRuntimeHealthResponse> => ({
      protocolVersion: appProtocolVersion,
      status: connection.isConfigured()
        ? AppRuntimeHealthStatus.HEALTHY
        : AppRuntimeHealthStatus.DEGRADED,
      appId: bindings.appId,
      appVersion: bindings.appVersion,
      checkedAt: now().toISOString(),
      ...(!connection.isConfigured()
        ? { message: "Google Calendar OAuth is not configured by the App operator." }
        : {})
    })
  };
}
