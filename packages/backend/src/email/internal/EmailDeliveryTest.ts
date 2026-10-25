import { Context, Effect, Layer, Ref } from "effect";

import { EmailDelivery } from "#email/EmailDelivery.ts";
import type { EmailMessage } from "#email/EmailDelivery.ts";

export class EmailOutbox extends Context.Service<
  EmailOutbox,
  { readonly messages: Effect.Effect<ReadonlyArray<EmailMessage>> }
>()("@sourdough/backend/email/internal/EmailDeliveryTest/EmailOutbox") {}

export const EmailDeliveryTest: Layer.Layer<EmailDelivery | EmailOutbox> = Layer.unwrap(
  Effect.map(Ref.make<ReadonlyArray<EmailMessage>>([]), (sent) =>
    Layer.merge(
      Layer.succeed(EmailDelivery)({
        send: (message) => Ref.update(sent, (messages) => [...messages, message]),
      }),
      Layer.succeed(EmailOutbox)({ messages: Ref.get(sent) }),
    ),
  ),
);
