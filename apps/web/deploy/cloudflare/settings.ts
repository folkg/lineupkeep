export const cloudflareCompatibility = Object.freeze({
  date: "2026-10-01",
  flags: Object.freeze(["nodejs_compat", "global_fetch_strictly_public"]),
});

export function assertPublicRouting(configuration: {
  readonly compatibility?: { readonly flags?: ReadonlyArray<string> };
}): void {
  if (configuration.compatibility?.flags?.includes("global_fetch_strictly_public") !== true) {
    throw new Error(
      "Missing global_fetch_strictly_public permits private or special-use connections from the isolate; generate Worker compatibility settings with workerConfiguration in apps/web/deploy/cloudflare/settings.ts and rerun bun run targets:verify.",
    );
  }
}

export function workerConfiguration<Main>(main: Main): {
  main: Main;
  bundle: false;
  compatibility: {
    date: "2026-10-01";
    flags: string[];
  };
} {
  return {
    main,
    bundle: false as const,
    compatibility: { ...cloudflareCompatibility, flags: [...cloudflareCompatibility.flags] },
  };
}
