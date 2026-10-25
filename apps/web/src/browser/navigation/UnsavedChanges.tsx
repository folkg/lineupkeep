import type { JSX } from "@solidjs/web";
import type { ShouldBlockFn } from "@tanstack/solid-router";

import { ConfirmDialog } from "#browser/shared-ui/ConfirmDialog.tsx";

import {
  UnsavedChangesContext,
  createUnsavedChanges,
  useUnsavedNavigationBlocker,
} from "./useUnsavedChanges";

export function UnsavedChangesScope(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <UnsavedChangesContext value={createUnsavedChanges()}>{props.children}</UnsavedChangesContext>
  );
}

export function UnsavedNavigationGuard(props: {
  readonly shouldBlock: ShouldBlockFn;
}): JSX.Element {
  const navigation = useUnsavedNavigationBlocker((locations) => props.shouldBlock(locations));
  return (
    <ConfirmDialog
      open={navigation.isBlocked()}
      onCancel={navigation.stay}
      onConfirm={navigation.leave}
      title="Discard unfinished work?"
      description="Your unsubmitted input will be lost. A request already sent may still complete."
      cancelLabel="Keep editing"
      confirmLabel="Discard and leave"
    />
  );
}
