declare module "cloudflare:workers" {
  export const env: {
    readonly HYPERDRIVE: { readonly connectionString: string };
  };
  export function waitUntil(promise: Promise<unknown>): void;
}
