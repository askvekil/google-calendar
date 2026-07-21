import { z } from "zod";
import { googleCalendarProviderScopes } from "../contracts";

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive().optional(),
  id_token: z.string().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  token_type: z.string().optional()
});

const userInfoSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  picture: z.string().url().optional(),
  sub: z.string().min(1),
  verified_email: z.boolean().optional()
});

const oauthErrorSchema = z.object({
  error: z.string().optional(),
  error_description: z.string().optional()
});

const defaultOAuthRequestTimeoutMs = 15_000;

export interface GoogleOAuthToken {
  accessToken: string;
  expiresInSeconds: number;
  idToken?: string;
  refreshToken?: string;
  scopes: string[];
  tokenType?: string;
}

export interface GoogleOAuthIdentity {
  email: string;
  id: string;
  metadata: Record<string, unknown>;
}

export interface GoogleCalendarOAuthClient {
  createAuthorizationUrl(input: {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }): URL;
  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleOAuthToken>;
  fetchIdentity(accessToken: string): Promise<GoogleOAuthIdentity>;
  refreshToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<GoogleOAuthToken>;
  revokeToken(token: string): Promise<void>;
}

export enum GoogleCalendarOAuthErrorCode {
  AUTHORIZATION_REJECTED = "AUTHORIZATION_REJECTED",
  INVALID_GRANT = "INVALID_GRANT",
  INVALID_RESPONSE = "INVALID_RESPONSE",
  MISSING_SCOPE = "MISSING_SCOPE",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
}

export class GoogleCalendarOAuthError extends Error {
  readonly code: GoogleCalendarOAuthErrorCode;
  readonly reconnectRequired: boolean;
  readonly retryable: boolean;

  constructor({
    code,
    message,
    reconnectRequired = false,
    retryable = false
  }: {
    code: GoogleCalendarOAuthErrorCode;
    message: string;
    reconnectRequired?: boolean;
    retryable?: boolean;
  }) {
    super(message);
    this.name = "GoogleCalendarOAuthError";
    this.code = code;
    this.reconnectRequired = reconnectRequired;
    this.retryable = retryable;
  }
}

export class GoogleCalendarHttpOAuthClient implements GoogleCalendarOAuthClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;

  constructor(fetchImpl: typeof fetch = fetch, requestTimeoutMs = defaultOAuthRequestTimeoutMs) {
    this.fetchImpl = fetchImpl;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  createAuthorizationUrl({
    clientId,
    codeChallenge,
    redirectUri,
    state
  }: {
    clientId: string;
    codeChallenge: string;
    redirectUri: string;
    state: string;
  }): URL {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent select_account");
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", googleCalendarProviderScopes.join(" "));
    url.searchParams.set("state", state);
    return url;
  }

  exchangeCode(input: {
    clientId: string;
    clientSecret: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GoogleOAuthToken> {
    return this.requestToken(
      new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        code: input.code,
        code_verifier: input.codeVerifier,
        grant_type: "authorization_code",
        redirect_uri: input.redirectUri
      })
    );
  }

  refreshToken(input: {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
  }): Promise<GoogleOAuthToken> {
    return this.requestToken(
      new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: "refresh_token",
        refresh_token: input.refreshToken
      })
    );
  }

  async fetchIdentity(accessToken: string): Promise<GoogleOAuthIdentity> {
    const response = await this.request("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new GoogleCalendarOAuthError({
          code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
          message: "Google OAuth is temporarily unavailable.",
          retryable: true
        });
      }

      throw new GoogleCalendarOAuthError({
        code: GoogleCalendarOAuthErrorCode.AUTHORIZATION_REJECTED,
        message: "Google rejected the connected account token.",
        reconnectRequired: response.status === 401
      });
    }

    try {
      const identity = userInfoSchema.parse(await response.json());
      return {
        email: identity.email,
        id: identity.sub,
        metadata: {
          name: identity.name ?? null,
          pictureUrl: identity.picture ?? null,
          verifiedEmail: identity.verified_email ?? null
        }
      };
    } catch {
      throw invalidResponse();
    }
  }

  async revokeToken(token: string): Promise<void> {
    const response = await this.request("https://oauth2.googleapis.com/revoke", {
      body: new URLSearchParams({ token }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });

    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      throw new GoogleCalendarOAuthError({
        code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
        message: "Google token revocation is temporarily unavailable.",
        retryable: true
      });
    }
  }

  private async requestToken(body: URLSearchParams): Promise<GoogleOAuthToken> {
    const response = await this.request("https://oauth2.googleapis.com/token", {
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST"
    });

    if (!response.ok) {
      let providerCode: string | undefined;

      try {
        providerCode = oauthErrorSchema.parse(await response.json()).error;
      } catch {
        providerCode = undefined;
      }

      const invalidGrant = providerCode === "invalid_grant";
      throw new GoogleCalendarOAuthError({
        code: invalidGrant
          ? GoogleCalendarOAuthErrorCode.INVALID_GRANT
          : GoogleCalendarOAuthErrorCode.AUTHORIZATION_REJECTED,
        message: invalidGrant
          ? "Google authorization expired or was revoked."
          : "Google rejected the authorization request.",
        reconnectRequired: invalidGrant,
        retryable: response.status === 429 || response.status >= 500
      });
    }

    try {
      const token = tokenResponseSchema.parse(await response.json());
      return {
        accessToken: token.access_token,
        expiresInSeconds: token.expires_in ?? 3_600,
        ...(token.id_token ? { idToken: token.id_token } : {}),
        ...(token.refresh_token ? { refreshToken: token.refresh_token } : {}),
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
        ...(token.token_type ? { tokenType: token.token_type } : {})
      };
    } catch {
      throw invalidResponse();
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(this.requestTimeoutMs)
      });
    } catch {
      throw new GoogleCalendarOAuthError({
        code: GoogleCalendarOAuthErrorCode.PROVIDER_UNAVAILABLE,
        message: "Google OAuth is temporarily unavailable.",
        retryable: true
      });
    }
  }
}

function invalidResponse(): GoogleCalendarOAuthError {
  return new GoogleCalendarOAuthError({
    code: GoogleCalendarOAuthErrorCode.INVALID_RESPONSE,
    message: "Google OAuth returned an invalid response."
  });
}
