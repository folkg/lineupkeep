const maximumFaabBid = 1_000_000;

export type WaiverBidReading =
  | { readonly bid: number; readonly error?: undefined }
  | { readonly bid?: undefined; readonly error: string };

export function readWaiverBid(raw: string): WaiverBidReading {
  const value = raw.trim();
  if (value === "") {
    return { error: "Enter a whole number of FAAB from 0 upward." };
  }
  if (!/^-?\d+$/u.test(value)) {
    return {
      error: `A FAAB bid is a whole number of FAAB from 0 upward, so ${value} cannot be sent.`,
    };
  }
  const bid = Number(value);
  if (!Number.isSafeInteger(bid) || bid > maximumFaabBid) {
    return {
      error: `A FAAB bid can be at most ${String(maximumFaabBid)}, so ${value} cannot be sent.`,
    };
  }
  if (bid < 0) {
    return {
      error: `The league's minimum FAAB bid is 0, so ${value} cannot be sent. Enter 0 or more.`,
    };
  }
  return { bid };
}

export function waiverBidBudgetError(
  bid: number,
  remaining: number | undefined,
): string | undefined {
  if (remaining === undefined || bid <= remaining) {
    return undefined;
  }
  return `The bid of ${String(bid)} exceeds this team's remaining FAAB budget of ${String(remaining)}. Lower the bid to ${String(remaining)} or less, then submit again.`;
}
