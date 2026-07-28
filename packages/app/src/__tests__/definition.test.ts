import {
  AppContactIdentityAttribute,
  AppRuntimeHost,
  appContactIdentityAttributeJsonSchemaKey
} from "@vekil/app-sdk";
import { createAppTestKit } from "@vekil/app-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  GoogleCalendarActionKey,
  GoogleCalendarArtifactKey,
  GoogleCalendarIntentKey,
  GoogleCalendarOutcomeKey,
  createGoogleCalendarDefinition
} from "..";

describe("Google Calendar App Definition", () => {
  it("compiles into the canonical Remote App manifest", () => {
    const { bindings, manifest } = createAppTestKit(
      createGoogleCalendarDefinition({ baseUrl: "https://calendar-runtime.example.com" })
    );

    expect(manifest.runtime.host).toBe(AppRuntimeHost.REMOTE);
    expect(manifest.actions.map((action) => action.id)).toContain(
      bindings.actionId(GoogleCalendarActionKey.CREATE_EVENT)
    );
    expect(
      manifest.actions.find(
        (action) => action.id === bindings.actionId(GoogleCalendarActionKey.CREATE_EVENT)
      )?.inputArtifacts
    ).toEqual([
      {
        artifactId: bindings.artifactId(GoogleCalendarArtifactKey.MEETING_SLOT),
        cardinality: "ONE",
        required: false,
        schemaVersion: 1
      }
    ]);
    expect(manifest.outcomes.map((outcome) => outcome.id)).toContain(
      bindings.outcomeId(GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE)
    );
    expect(
      manifest.outcomes.find(
        (outcome) => outcome.id === bindings.outcomeId(GoogleCalendarOutcomeKey.SLOT_UNAVAILABLE)
      )
    ).toMatchObject({
      nextActions: [
        {
          id: bindings.appId.concat(".request-meeting")
        }
      ],
      status: "SUCCESS"
    });
    expect(
      manifest.outcomes.find(
        (outcome) =>
          outcome.id === bindings.outcomeId(GoogleCalendarOutcomeKey.AVAILABILITY_SUCCESS)
      )
    ).toMatchObject({
      nextActions: []
    });
    const meetingIntent = manifest.intents.find(
      (intent) => intent.id === bindings.intentId(GoogleCalendarIntentKey.MEETING_CREATE)
    );
    const meetingProperties = meetingIntent?.inputSchema.properties as
      Record<string, Record<string, unknown>> | undefined;

    expect(meetingProperties?.["requester-email"]).toMatchObject({
      [appContactIdentityAttributeJsonSchemaKey]: AppContactIdentityAttribute.EMAIL,
      format: "email",
      title: "Requester email",
      type: "string"
    });
    expect(meetingProperties?.["attendee-emails"]).not.toHaveProperty(
      appContactIdentityAttributeJsonSchemaKey
    );
    manifest.intents.forEach((intent) => {
      const properties = new Set(Object.keys(intent.inputSchema.properties ?? {}));

      expect(Object.keys(intent.entityHints).every((field) => properties.has(field))).toBe(true);
    });
    expect(
      manifest.outcomes.find(
        (outcome) =>
          outcome.id === bindings.outcomeId(GoogleCalendarOutcomeKey.MEETING_OPTIONS_SUCCESS)
      )
    ).toMatchObject({
      nextActions: [
        {
          id: bindings.appId.concat(".request-meeting")
        }
      ]
    });
    expect(
      manifest.outcomes.find(
        (outcome) =>
          outcome.id === bindings.outcomeId(GoogleCalendarOutcomeKey.RESCHEDULE_SLOT_UNAVAILABLE)
      )
    ).toMatchObject({
      nextActions: [
        {
          id: bindings.appId.concat(".reschedule-meeting")
        }
      ]
    });
  });
});
