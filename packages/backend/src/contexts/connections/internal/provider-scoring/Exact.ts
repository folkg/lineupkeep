export type Exact = {
  readonly units: bigint;
  readonly scale: number;
};

const DecimalText = /^-?\d+(?:\.\d+)?$/u;

export function parseExact(text: string): Exact {
  if (!DecimalText.test(text)) {
    throw new Error(`"${text}" is not a plain decimal.`);
  }
  const negative = text.startsWith("-");
  const [whole = "", fraction = ""] = (negative ? text.slice(1) : text).split(".");
  const magnitude = BigInt(whole + fraction);
  return exact(negative ? -magnitude : magnitude, fraction.length);
}

export function exactFromInteger(units: bigint): Exact {
  return exact(units, 0);
}

export function addExact(left: Exact, right: Exact): Exact {
  const scale = Math.max(left.scale, right.scale);
  return exact(unitsAtScale(left, scale) + unitsAtScale(right, scale), scale);
}

export function multiplyExact(left: Exact, right: Exact): Exact {
  return exact(left.units * right.units, left.scale + right.scale);
}

export function divideByInteger(value: Exact, divisor: bigint, scale: number): Exact {
  if (divisor === 0n) {
    throw new Error("Cannot divide by zero.");
  }
  const numerator = unitsAtScale(value, value.scale + scale);
  return exact(divideRoundHalfAwayFromZero(numerator, divisor), scale);
}

export function minExact(left: Exact, right: Exact): Exact {
  return compareExact(left, right) <= 0 ? left : right;
}

export function clampExact(value: Exact, minimum: Exact, maximum: Exact): Exact {
  return compareExact(value, minimum) < 0
    ? minimum
    : compareExact(value, maximum) > 0
      ? maximum
      : value;
}

export function compareExact(left: Exact, right: Exact): number {
  const scale = Math.max(left.scale, right.scale);
  const leftUnits = unitsAtScale(left, scale);
  const rightUnits = unitsAtScale(right, scale);
  return leftUnits === rightUnits ? 0 : leftUnits < rightUnits ? -1 : 1;
}

export function exactToUnits(value: Exact, scale: number): bigint {
  return unitsAtScale(value, scale);
}

function exact(units: bigint, scale: number): Exact {
  let nextUnits = units;
  let nextScale = scale;
  while (nextScale > 0 && nextUnits % 10n === 0n) {
    nextUnits /= 10n;
    nextScale -= 1;
  }
  return { units: nextUnits, scale: nextScale };
}

function unitsAtScale(value: Exact, scale: number): bigint {
  if (scale === value.scale) {
    return value.units;
  }
  if (scale > value.scale) {
    return value.units * 10n ** BigInt(scale - value.scale);
  }
  return divideRoundHalfAwayFromZero(value.units, 10n ** BigInt(value.scale - scale));
}

function divideRoundHalfAwayFromZero(numerator: bigint, divisor: bigint): bigint {
  const negative = numerator < 0n;
  const magnitude = negative ? -numerator : numerator;
  const quotient = (magnitude * 2n + divisor) / (divisor * 2n);
  return negative ? -quotient : quotient;
}
