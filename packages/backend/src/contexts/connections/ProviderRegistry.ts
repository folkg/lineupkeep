import { Context, Effect } from "effect";

import { ProviderUnregistered } from "./Provider.ts";
import type { Provider } from "./Provider.ts";
import type { ProviderKey } from "./ProviderKey.ts";

export class ProviderRegistry extends Context.Service<ProviderRegistry, ProviderRegistryShape>()(
  "@lineupkeep/backend/contexts/connections/ProviderRegistry",
) {}

export type ProviderRegistryShape = {
  readonly get: (key: ProviderKey) => Provider | undefined;

  readonly requireProvider: (key: ProviderKey) => Effect.Effect<Provider, ProviderUnregistered>;
};

export function providerRegistryOf(providers: ReadonlyArray<Provider>): ProviderRegistryShape {
  const byKey = new Map(providers.map((provider) => [provider.key, provider]));
  return {
    get: (key) => byKey.get(key),
    requireProvider: (key) => {
      const provider = byKey.get(key);
      return provider === undefined
        ? Effect.fail(ProviderUnregistered.make({ provider: key }))
        : Effect.succeed(provider);
    },
  };
}
