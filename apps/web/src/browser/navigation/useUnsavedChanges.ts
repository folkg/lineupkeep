import { useBlocker } from "@tanstack/solid-router";
import type { ShouldBlockFn } from "@tanstack/solid-router";
import { createContext, onSettled, useContext } from "solid-js";
import type { Accessor } from "solid-js";

export const UnsavedChangesContext = createContext<UnsavedChanges>();

export function createUnsavedChanges(): UnsavedChanges {
  const sources = new Set<Accessor<boolean>>();
  return {
    register: (read) => {
      sources.add(read);
      onSettled(() => () => {
        sources.delete(read);
      });
    },
    hasUnsavedChanges: () => Array.from(sources).some((read) => read()),
  };
}

export function useUnsavedChanges(read: Accessor<boolean>): void {
  useContext(UnsavedChangesContext).register(read);
}

export function useUnsavedNavigationBlocker(shouldBlock: ShouldBlockFn): {
  isBlocked: () => boolean;
  stay: () => void | undefined;
  leave: () => void | undefined;
} {
  const changes = useContext(UnsavedChangesContext);
  const blocker = useBlocker({
    shouldBlockFn: (locations) => changes.hasUnsavedChanges() && shouldBlock(locations),
    enableBeforeUnload: changes.hasUnsavedChanges,
    withResolver: true,
  });
  return {
    isBlocked: () => blocker().status === "blocked",
    stay: () => blocker().reset?.(),
    leave: () => blocker().proceed?.(),
  };
}

type UnsavedChanges = {
  readonly register: (read: Accessor<boolean>) => void;
  readonly hasUnsavedChanges: Accessor<boolean>;
};
