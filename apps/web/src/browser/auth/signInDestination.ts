export function signInDestinations(
  rawQuery: string,
  redirect: string | undefined,
): {
  returnTo: string;
  errorReturnTo: string;
} {
  const returnTo = redirect !== undefined && isApplicationPath(redirect) ? redirect : "/notes";
  return {
    returnTo,

    errorReturnTo: new URLSearchParams(rawQuery).has("sig")
      ? `/auth${rawQuery}`
      : `/auth?${new URLSearchParams({ redirect: returnTo }).toString()}`,
  };
}

export function isApplicationPath(path: string): boolean {
  const base = "http://application.invalid";
  return path.startsWith("/") && new URL(path, base).origin === base;
}
