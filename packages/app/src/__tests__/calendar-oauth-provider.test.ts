import { describe, expect, it } from "vitest";
import {
  GoogleCalendarHttpOAuthClient,
  GoogleCalendarOAuthErrorCode,
  googleCalendarProviderScopes
} from "..";

describe("Google Calendar OAuth provider contract", () => {
  it("builds an offline PKCE authorization request with the exact required scopes", () => {
    const oauth = new GoogleCalendarHttpOAuthClient();
    const url = oauth.createAuthorizationUrl({
      clientId: "client-id",
      codeChallenge: "code-challenge",
      redirectUri: "https://calendar-runtime.vekil.example/oauth/google/callback",
      state: "state-token"
    });

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("prompt")).toBe("consent select_account");
    expect(url.searchParams.get("state")).toBe("state-token");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.freebusy",
      "https://www.googleapis.com/auth/calendar.events"
    ]);
  });

  it("exchanges a PKCE code without exposing the client secret outside the token request", async () => {
    const requests: Array<{ body: URLSearchParams; url: string }> = [];
    const oauth = new GoogleCalendarHttpOAuthClient(async (input, init) => {
      requests.push({
        body: init?.body as URLSearchParams,
        url: input.toString()
      });
      return Response.json({
        access_token: "access-token",
        expires_in: 3_600,
        refresh_token: "refresh-token",
        scope: googleCalendarProviderScopes.join(" "),
        token_type: "Bearer"
      });
    });

    await expect(
      oauth.exchangeCode({
        clientId: "client-id",
        clientSecret: "client-secret",
        code: "authorization-code",
        codeVerifier: "code-verifier",
        redirectUri: "https://calendar-runtime.vekil.example/oauth/google/callback"
      })
    ).resolves.toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      scopes: [...googleCalendarProviderScopes]
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(requests[0]?.body.get("client_secret")).toBe("client-secret");
    expect(requests[0]?.body.get("code_verifier")).toBe("code-verifier");
  });

  it("maps invalid_grant to a reconnect-required credential failure", async () => {
    const oauth = new GoogleCalendarHttpOAuthClient(async () =>
      Promise.resolve(
        Response.json(
          {
            error: "invalid_grant",
            error_description: "Token has been expired or revoked."
          },
          { status: 400 }
        )
      )
    );

    await expect(
      oauth.refreshToken({
        clientId: "client-id",
        clientSecret: "client-secret",
        refreshToken: "revoked-refresh-token"
      })
    ).rejects.toMatchObject({
      code: GoogleCalendarOAuthErrorCode.INVALID_GRANT,
      reconnectRequired: true,
      retryable: false
    });
  });

  it.each([429, 503])("maps identity status %s to a retryable provider outage", async (status) => {
    const oauth = new GoogleCalendarHttpOAuthClient(async () =>
      Promise.resolve(Response.json({}, { status }))
    );

    await expect(oauth.fetchIdentity("access-token")).rejects.toMatchObject({
      code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true
    });
  });

  it("bounds OAuth provider latency", async () => {
    const fetchImpl: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true
        });
      });
    const oauth = new GoogleCalendarHttpOAuthClient(fetchImpl, 5);

    await expect(oauth.fetchIdentity("access-token")).rejects.toMatchObject({
      code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
      retryable: true
    });
  });
});
