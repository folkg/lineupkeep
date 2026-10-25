import { defineWebSocketHandler } from "h3";

import { hostedLinkingHooks } from "./hostedLinkingStream.ts";

export default defineWebSocketHandler((event) => {
  const sessionId = event.context.params?.["sessionId"];
  if (sessionId === undefined) {
    throw new Error("The hosted linking stream requires a session id");
  }
  return hostedLinkingHooks(event.req, sessionId);
});
