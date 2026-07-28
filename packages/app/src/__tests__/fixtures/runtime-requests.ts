import {
  appContextProtocolVersion,
  appExecuteActionRequestSchema,
  appPlanActionRequestSchema,
  appProtocolVersion,
  type AppExecuteActionRequest,
  type AppPlanActionRequest,
  type JsonObject
} from "@vekil/app-sdk/runtime";
import { createAppTestKit } from "@vekil/app-sdk/testing";
import {
  GoogleCalendarActionKey,
  GoogleCalendarCapabilityKey,
  GoogleCalendarIntentKey,
  createGoogleCalendarDefinition
} from "../..";

const googleCalendarTestKit = createAppTestKit(
  createGoogleCalendarDefinition({ baseUrl: "https://calendar-runtime.test" })
);
export const googleCalendarTestManifest = googleCalendarTestKit.manifest;
export const googleCalendarTestBindings = googleCalendarTestKit.bindings;
export const googleCalendarTestAppVersionId = "calendar-runtime-test-version-1";

export function createCalendarExecutionRequest({
  actionKey,
  input,
  intentKey = GoogleCalendarIntentKey.MEETING_CREATE,
  responseLocale = "en"
}: {
  actionKey: GoogleCalendarActionKey;
  input: JsonObject;
  intentKey?: GoogleCalendarIntentKey;
  responseLocale?: string;
}): AppExecuteActionRequest {
  const actionId = googleCalendarTestBindings.actionId(actionKey);

  return appExecuteActionRequestSchema.parse({
    protocolVersion: appProtocolVersion,
    requestId: "request-calendar-1",
    executionId: "execution-calendar-1",
    grant: grant(),
    actionId,
    input,
    context: context({ actionId, input, intentKey, responseLocale }),
    idempotencyKey: "calendar-idempotency-key-1",
    attempt: 1
  });
}

export function createCalendarPlanRequest({
  input,
  intentKey,
  requesterDisplayName = "Alex"
}: {
  input: JsonObject;
  intentKey: GoogleCalendarIntentKey;
  requesterDisplayName?: string | null;
}): AppPlanActionRequest {
  const actionId = googleCalendarTestBindings.actionId(GoogleCalendarActionKey.CREATE_EVENT);

  return appPlanActionRequestSchema.parse({
    protocolVersion: appProtocolVersion,
    requestId: "plan-calendar-1",
    grant: grant(),
    intentId: googleCalendarTestBindings.intentId(intentKey),
    input,
    context: context({ actionId, input, intentKey, requesterDisplayName })
  });
}

function grant() {
  return {
    protocolVersion: appProtocolVersion,
    grantId: "grant-calendar-1",
    installationId: "installation-calendar-1",
    connectionId: "connection-calendar-1",
    connectionRevision: 1,
    authorizationContractHash: "a".repeat(64),
    appId: googleCalendarTestBindings.appId,
    appVersionId: googleCalendarTestAppVersionId,
    appVersion: googleCalendarTestBindings.appVersion,
    targetVekilId: "vekil-1",
    runtimeAudience: googleCalendarTestBindings.appId,
    capabilityIds: Object.values(GoogleCalendarCapabilityKey).map((key) =>
      googleCalendarTestBindings.capabilityId(key)
    ),
    permissionKeys: [],
    contextScopes: [],
    issuedAt: "2026-07-11T00:00:00.000Z",
    expiresAt: "2099-07-11T00:05:00.000Z"
  };
}

function context({
  actionId,
  input,
  intentKey = GoogleCalendarIntentKey.MEETING_CREATE,
  requesterDisplayName = "Alex",
  responseLocale = "en"
}: {
  actionId: string;
  input: JsonObject;
  intentKey?: GoogleCalendarIntentKey;
  requesterDisplayName?: string | null;
  responseLocale?: string;
}) {
  return {
    "protocol-version": appContextProtocolVersion,
    "context-id": "context-calendar-1",
    "context-type": "action-execution",
    "issued-at": "2026-07-11T00:00:00.000Z",
    "expires-at": "2099-07-11T00:05:00.000Z",
    platform: {
      name: "vekil",
      environment: "test",
      "protocol-version": appContextProtocolVersion
    },
    app: {
      "app-id": googleCalendarTestBindings.appId,
      "app-version-id": googleCalendarTestAppVersionId,
      "app-version": googleCalendarTestBindings.appVersion,
      "developer-id": "builder-test",
      "runtime-type": "remote"
    },
    installation: {
      "app-installation-id": "installation-calendar-1",
      "target-agent-id": "vekil-1",
      status: "installed",
      "runtime-status": "ready"
    },
    execution: {
      "execution-id": "execution-calendar-1",
      "request-id": "request-calendar-1",
      "action-plan-id": "plan-calendar-1",
      "action-step-id": "step-calendar-1",
      "idempotency-key": "calendar-idempotency-key-1",
      attempt: 1
    },
    origin: {
      type: "public-verified-external",
      entrypoint: "public-vekil-page"
    },
    viewer: {
      type: "verified-external",
      "display-name": requesterDisplayName,
      contact: {
        email: "alex@example.com"
      }
    },
    "target-vekil": {
      handle: "komron",
      "display-name": "Komron",
      "profile-url": "https://vekil.me/komron",
      type: "person",
      timezone: "Asia/Samarkand"
    },
    request: {
      id: "request-calendar-1",
      "intent-id": googleCalendarTestBindings.intentId(intentKey),
      status: "executing",
      "natural-language-summary": "Coordinate a meeting",
      entities: input,
      "missing-fields": [],
      locale: "en"
    },
    action: {
      "action-id": actionId,
      "capability-id": googleCalendarTestBindings.capabilityId(
        GoogleCalendarCapabilityKey.EVENT_CREATE
      ),
      "risk-level": "MEDIUM",
      "side-effect": true
    },
    input,
    settings: {
      "selected-calendar-id": "primary",
      "default-duration-minutes": 30,
      "working-days": ["monday", "tuesday", "wednesday", "thursday", "friday"],
      "working-day-start": "09:00",
      "working-day-end": "18:00",
      "buffer-before-minutes": 0,
      "buffer-after-minutes": 0,
      "minimum-notice-hours": 2
    },
    "policy-result": {
      allowed: true,
      "requires-approval": true,
      "risk-level": "MEDIUM",
      constraints: {},
      redactions: []
    },
    "approval-result": {
      status: "approved",
      "approved-at": "2026-07-11T00:01:00.000Z"
    },
    locale: {
      "requester-locale": "en",
      "owner-locale": "en",
      "app-locale": "en",
      "response-locale": responseLocale,
      timezone: "Asia/Samarkand"
    },
    security: {
      "signature-algorithm": "ed25519-jws-v1",
      "signed-fields": []
    }
  };
}
