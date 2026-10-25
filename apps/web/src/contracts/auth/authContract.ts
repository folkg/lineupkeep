export type AuthenticationFailureResult = {
  readonly type: "error";
  readonly error: AuthenticationFailure;
};

export type AuthenticationFailure = { readonly type: "auth.required" };

export type SessionView =
  | { readonly status: "anonymous" }
  | { readonly status: "authenticated"; readonly userId: string };

export type SignInMethodsView = import("@sourdough/backend/auth/Auth").SignInMethods;
