import { QueryClient } from "@tanstack/solid-query";
import { expect, it } from "vitest";

import { noteQueries } from "./noteQueries";
import type { NoteRemote } from "./noteRemote";

it("passes query cancellation to the notes remote", async () => {
  using fixture = setup();
  const { queryClient } = fixture;
  let receivedSignal: AbortSignal | undefined;
  const remote: Pick<NoteRemote, "list"> = {
    list: (_input, options) => {
      receivedSignal = options.signal;
      return new Promise(() => undefined);
    },
  };
  const listQuery = noteQueries.list(remote, { lifecycle: "active" });

  const request = queryClient.fetchInfiniteQuery(listQuery);
  await Promise.resolve();
  await queryClient.cancelQueries({ queryKey: listQuery.queryKey });
  await request.catch(() => undefined);

  expect(receivedSignal?.aborted).toBe(true);
});

function setup(): { queryClient: QueryClient } & Disposable {
  const queryClient = new QueryClient();
  return { queryClient, [Symbol.dispose]: () => queryClient.clear() };
}
