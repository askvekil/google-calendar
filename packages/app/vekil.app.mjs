import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createGoogleCalendarDefinition } = require("@vekil/google-calendar-app");

const baseUrl = process.env.GOOGLE_CALENDAR_RUNTIME_BASE_URL ?? "http://localhost:4100";

export default createGoogleCalendarDefinition({ baseUrl });
