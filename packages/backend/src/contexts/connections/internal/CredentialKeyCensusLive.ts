import { Effect, Layer } from "effect";

import { ConnectionPersistenceFailed } from "#contexts/connections/Connection.ts";
import {
  CredentialKeyCensus,
  type CredentialKeyReport,
  type CredentialKeyUsage,
} from "#contexts/connections/CredentialKeyCensus.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { ConnectionCredentialRepository } from "./ConnectionCredentialRepository.ts";
import { decodeCredentialEnvelope } from "./CredentialEnvelope.ts";

export const CredentialKeyCensusLive = Layer.effect(
  CredentialKeyCensus,
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const credentials = yield* ConnectionCredentialRepository;

    const report = Effect.fn("CredentialKeyCensus.report")(function* () {
      const envelopes = yield* credentials.listAllEnvelopes();
      const keyVersions = yield* Effect.forEach(envelopes, (envelope) =>
        decodeCredentialEnvelope(envelope).pipe(
          Effect.map((decoded) => decoded.keyVersion),
          Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })),
        ),
      );
      const usage = countKeyVersions(keyVersions);
      const currentKeyVersion = encryption.currentKeyVersion;
      const readable = new Set([currentKeyVersion, ...encryption.retainedKeyVersions]);
      const summary: CredentialKeyReport = {
        currentKeyVersion,
        retainedKeyVersions: encryption.retainedKeyVersions,
        usage,
        olderEnvelopes: totalMatching(usage, (entry) => entry.keyVersion !== currentKeyVersion),
        unreadableEnvelopes: totalMatching(usage, (entry) => !readable.has(entry.keyVersion)),
      };
      yield* Effect.annotateCurrentSpan({
        "connection.credential_current_key_version": summary.currentKeyVersion,
        "connection.credential_older_envelopes": summary.olderEnvelopes,
        "connection.credential_unreadable_envelopes": summary.unreadableEnvelopes,
        "connection.credential_key_versions": summary.usage.map(
          (entry) => `${String(entry.keyVersion)}:${String(entry.envelopes)}`,
        ),
      });
      return summary;
    });

    return CredentialKeyCensus.of({ report: report() });
  }),
);

function countKeyVersions(keyVersions: ReadonlyArray<number>): ReadonlyArray<CredentialKeyUsage> {
  const counts = new Map<number, number>();
  for (const keyVersion of keyVersions) {
    counts.set(keyVersion, (counts.get(keyVersion) ?? 0) + 1);
  }
  return [...counts]
    .sort(([left], [right]) => left - right)
    .map(([keyVersion, envelopes]) => ({ keyVersion, envelopes }));
}

function totalMatching(
  usage: ReadonlyArray<CredentialKeyUsage>,
  matches: (entry: CredentialKeyUsage) => boolean,
): number {
  return usage.filter(matches).reduce((total, entry) => total + entry.envelopes, 0);
}
