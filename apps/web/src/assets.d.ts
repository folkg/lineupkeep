/// <reference types="vite/client" />

declare module "*.css";

declare module "virtual:solid-diagnostics/client";

declare module "~icons/*" {
  import type { JSX } from "@solidjs/web";

  const component: (props: JSX.SVGSVGAttributes<SVGSVGElement>) => JSX.Element;
  export default component;
}
