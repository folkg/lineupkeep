import type { JSX } from "@solidjs/web";
import ArrowUpRight from "~icons/lucide/arrow-up-right";
import LoaderCircle from "~icons/lucide/loader-circle";
import Moon from "~icons/lucide/moon";
import Sun from "~icons/lucide/sun";
import X from "~icons/lucide/x";

import googleG from "./brand/google-g.svg";

export const ArrowUpRightIcon = icon(ArrowUpRight);
export const LoaderCircleIcon = icon(LoaderCircle);
export const MoonIcon = icon(Moon);
export const SunIcon = icon(Sun);
export const XIcon = icon(X);

export function GoogleGIcon(): JSX.Element {
  return <img alt="" height={20} src={googleG} width={20} />;
}

function icon(
  Svg: (props: JSX.SvgSVGAttributes<SVGSVGElement>) => JSX.Element,
): (props: IconProps) => JSX.Element {
  return (props: IconProps) => (
    <Svg
      class={props.spin === true ? "animate-spin motion-reduce:animate-none" : undefined}
      height={iconSize[props.size]}
      width={iconSize[props.size]}
    />
  );
}

const iconSize = { sm: 15, md: 17 };

type IconProps = {
  readonly size: keyof typeof iconSize;

  readonly spin?: boolean;
};
