import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

import { ProviderUnregistered } from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import { ProviderRegistry, providerRegistryOf } from "./ProviderRegistry.ts";

it.effect("reports an unregistered provider by key", () =>
  Effect.gen(function* () {
    const registry = ProviderRegistry.of(providerRegistryOf([]));
    const key = decodeProviderKey("other");

    assert.isUndefined(registry.get(key));
    const error = yield* Effect.flip(registry.requireProvider(key));
    assert.instanceOf(error, ProviderUnregistered);
    assert.strictEqual(error.provider, key);
  }),
);
