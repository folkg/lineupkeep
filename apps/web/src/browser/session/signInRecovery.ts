import { useLocation, useNavigate } from "@tanstack/solid-router";

import type { RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";

export function useSignInRecovery(): RecoveryAction {
  const navigate = useNavigate();
  const location = useLocation();
  return {
    label: "Sign in again",
    onAction: () => navigate({ to: "/auth", search: { redirect: location().href } }),
  };
}
