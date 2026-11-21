import { HostedLinking } from "@lineupkeep/backend/connections/HostedLinking";
import { HostedLinkingSessionInput } from "@lineupkeep/backend/connections/HostedLinking";
import { EffectString } from "@lineupkeep/collections";
import { optionalStringValue } from "@lineupkeep/collections";
import { createServerFn } from "@tanstack/solid-start";
import {
  deleteCookie,
  getRequest,
  setCookie,
  setResponseHeader,
} from "@tanstack/solid-start/server";
import { Array, DateTime, Effect, Redacted, Schema } from "effect";

import type {
  CancelHostedLinkingView,
  StartHostedLinkingView,
} from "#contracts/connections/connectionContract.ts";
import { deploymentTarget } from "#deployment-target";
import { runUseCase } from "#server/backendEntry.ts";
import {
  HostedBrowserUnsupported,
  HostedLinkingInputInvalid,
  mapHostedLinkingError,
  StartHostedLinkingRequest,
  toHostedLinkingSessionView,
} from "#server/connections/hostedLinkingPresentation.ts";

const hostedLinkingCookieName = "lineupkeep_hosted_link";

export const startHostedLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof StartHostedLinkingRequest.Encoded) =>
    Schema.decodeResult(StartHostedLinkingRequest)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "hosted_linking.start",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => HostedLinkingInputInvalid.make({})),
          );
          if (deploymentTarget.hostedBrowser === undefined) {
            return yield* HostedBrowserUnsupported.make({});
          }
          const started = yield* HostedLinking.use((service) =>
            service.start(userId, {
              provider: input.provider,
              ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
            }),
          );
          setResponseHeader("cache-control", "no-store");
          const session = toHostedLinkingSessionView(started.session);
          const streamPath = `/api/linking/session/${session.id}/stream`;
          const secure =
            EffectString.startsWith(request.url, "https://") ||
            optionalStringValue(request.headers.get("x-forwarded-proto"), (value) =>
              EffectString.trim(EffectString.split(value, ",")[0] ?? ""),
            ) === "https";
          const yielded1 = yield* DateTime.now;
          const now = DateTime.toEpochMillis(yielded1);
          setCookie(hostedLinkingCookieName, Redacted.value(started.ticket), {
            httpOnly: true,
            maxAge: Math.max(
              1,
              Math.ceil((DateTime.toEpochMillis(started.session.expiresAt) - now) / 1_000),
            ),
            path: streamPath,
            sameSite: "strict",
            secure,
          });
          return {
            session,
            streamPath: `${streamPath}?viewport=${input.viewport}`,
            viewport: input.viewport,
          } satisfies StartHostedLinkingView;
        }),
      mapHostedLinkingError,
    );
  });

export const cancelHostedLinkingServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof HostedLinkingSessionInput.Encoded) =>
    Schema.decodeResult(HostedLinkingSessionInput)(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "hosted_linking.cancel",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => HostedLinkingInputInvalid.make({})),
          );
          const sessions = yield* HostedLinking.use((service) =>
            service.cancel(userId, [{ id: input.id }]),
          );
          setResponseHeader("cache-control", "no-store");
          deleteCookie(hostedLinkingCookieName, {
            path: `/api/linking/session/${input.id}/stream`,
          });
          return {
            session: toHostedLinkingSessionView(Array.getUnsafe(sessions, 0)),
          } satisfies CancelHostedLinkingView;
        }),
      mapHostedLinkingError,
    );
  });
