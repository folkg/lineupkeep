import type { JSX } from "@solidjs/web";
import ArrowUpRight from "~icons/lucide/arrow-up-right";
import ChevronRight from "~icons/lucide/chevron-right";
import LoaderCircle from "~icons/lucide/loader-circle";
import Moon from "~icons/lucide/moon";
import Sun from "~icons/lucide/sun";
import X from "~icons/lucide/x";

import googleG from "./brand/google-g.svg";
import { cx } from "./cx";

export const ArrowUpRightIcon = icon(ArrowUpRight);
export const ChevronRightIcon = icon(ChevronRight);
export const LoaderCircleIcon = icon(LoaderCircle);
export const MoonIcon = icon(Moon);
export const PauseIcon = icon(PauseGlyph);
export const PlayIcon = icon(PlayGlyph);
export const SunIcon = icon(Sun);
export const XIcon = icon(X);

function PauseGlyph(props: JSX.SvgSVGAttributes<SVGSVGElement>): JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <path d="M9 5v14M15 5v14" />
    </svg>
  );
}

function PlayGlyph(props: JSX.SvgSVGAttributes<SVGSVGElement>): JSX.Element {
  return (
    <svg
      {...props}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      viewBox="0 0 24 24"
    >
      <path d="m7 4 12 8-12 8z" />
    </svg>
  );
}

export function GoogleGIcon(): JSX.Element {
  return <img alt="" height={20} src={googleG} width={20} />;
}

function icon(
  Svg: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element,
): (props: IconProps) => JSX.Element {
  return (props: IconProps) => (
    <Svg
      class={cx(props.class, props.spin === true && "animate-spin motion-reduce:animate-none")}
      height={iconSize[props.size]}
      width={iconSize[props.size]}
    />
  );
}

const iconSize = { sm: 15, md: 17 };

type IconProps = {
  readonly class?: string;
  readonly size: keyof typeof iconSize;

  readonly spin?: boolean;
};
