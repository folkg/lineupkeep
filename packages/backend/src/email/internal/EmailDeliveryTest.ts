import { Context, Effect, Layer, Ref } from "effect";

import { EmailDelivery } from "#email/EmailDelivery.ts";
import type { EmailMessage } from "#email/EmailDelivery.ts";

export class EmailOutbox extends Context.Service<
  EmailOutbox,
  { readonly messages: Effect.Effect<ReadonlyArray<EmailMessage>> }
>()("@lineupkeep/backend/email/internal/EmailDeliveryTest/EmailOutbox") {}

export const EmailDeliveryTest: Layer.Layer<EmailDelivery | EmailOutbox> = Layer.unwrap(
  Effect.map(Ref.make<ReadonlyArray<EmailMessage>>([]), (sent) =>
    Layer.merge(
      Layer.succeed(EmailDelivery)({
        send: (message) => Ref.update(sent, (messages) => [...messages, message]),
        sendMany: (messages) =>
          Ref.update(sent, (existing) => [...existing, ...messages]).pipe(
            Effect.as(messages.map(() => ({ _tag: "sent" as const }))),
          ),
      }),
      Layer.succeed(EmailOutbox)({ messages: Ref.get(sent) }),
    ),
  ),
);
