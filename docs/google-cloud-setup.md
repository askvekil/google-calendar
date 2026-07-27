# Google Cloud setup

The Runtime needs one Google OAuth web client owned by the App operator.

## 1. Create or select a project

Open Google Cloud Console and select the project that will operate this App.

## 2. Enable Google Calendar API

Enable **Google Calendar API** in **APIs & Services → Library**.

## 3. Configure the OAuth consent screen

Create an OAuth consent configuration and provide the required product,
support, and developer contact information.

For a project in testing mode, add every Google account used during local
development as a test user.

The Runtime requests:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.freebusy
https://www.googleapis.com/auth/calendar.events
```

## 4. Create a web OAuth client

Create an OAuth client with application type **Web application**.

Add this local authorized redirect URI:

```text
http://localhost:4100/oauth/google/callback
```

For deployment, add the same path under the public HTTPS Runtime origin:

```text
https://your-runtime.example.com/oauth/google/callback
```

The redirect URI must exactly match `GOOGLE_CALENDAR_RUNTIME_BASE_URL` plus
`/oauth/google/callback`.

## 5. Configure the Runtime

Run:

```bash
pnpm local:env
```

Then set these values in `.env`:

```dotenv
GOOGLE_CALENDAR_CLIENT_ID=your-client-id
GOOGLE_CALENDAR_CLIENT_SECRET=your-client-secret
```

Do not place either value in the App Definition, source code, browser bundle,
or Vekil environment. They belong only to the deployed Runtime.

## Troubleshooting

### `redirect_uri_mismatch`

The URI in Google Cloud does not exactly match the callback URI used by the
Runtime. Check scheme, host, port, path, and trailing slash.

### `access_denied`

The user cancelled authorization, the consent screen is restricted, or the
account is not listed as a test user.

### No refresh token

The Runtime requests offline access and explicit consent. If Google still does
not issue a refresh token, revoke the App's access in the Google account and
connect again.

### Missing scope

The consent configuration or OAuth grant does not include every required
scope. Reconnect after correcting the provider configuration.
