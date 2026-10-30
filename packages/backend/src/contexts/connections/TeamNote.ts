export const teamNoteLimit = 2_000;

type TeamNoteRejection = "too_long" | "credential_like";

export type TeamNoteCheck =
  | { readonly valid: true; readonly note: string | null }
  | { readonly valid: false; readonly reason: TeamNoteRejection; readonly message: string };

export function checkTeamNote(raw: string): TeamNoteCheck {
  const note = normalizedTeamNote(raw);
  const length = Array.from(note ?? "").length;
  if (length > teamNoteLimit) {
    return {
      valid: false,
      reason: "too_long",
      message: `A team note can be up to ${String(teamNoteLimit)} characters. Shorten it and save again.`,
    };
  }
  const credential = credentialShape(note ?? "");
  if (credential !== undefined) {
    return {
      valid: false,
      reason: "credential_like",
      message: `This looks like ${credential}. Lineupkeep does not store passwords, tokens, or provider session material in a team note. Remove it and save again.`,
    };
  }
  return { valid: true, note };
}

function normalizedTeamNote(raw: string): string | null {
  const note = Array.from(raw.replace(/\r\n?/gu, "\n"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("")
    .trim();
  return note.length === 0 ? null : note;
}

function credentialShape(text: string): string | undefined {
  return credentialShapes.find((shape) => shape.pattern.test(text))?.label;
}

const credentialShapes: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u, label: "a private key" },
  {
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
    label: "a sign-in token",
  },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/u, label: "an access key" },
  {
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
    label: "a sign-in token",
  },
  { pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/u, label: "a sign-in token" },
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}\b/u, label: "a secret key" },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/u, label: "an API key" },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/iu,
    label: "a sign-in token",
  },
  {
    pattern:
      /\b(?:password|passwd|passphrase|secret|token|api[ _-]?key|access[ _-]?key|client[ _-]?secret|private[ _-]?key|session[ _-]?cookie|authorization)\b\s*[:=]\s*\S{6,}/iu,
    label: "a password or token assignment",
  },
  {
    pattern: /(?:^|[;&\s])(?:T|Y|A3?)=[A-Za-z0-9%._-]{16,}/u,
    label: "a provider session cookie",
  },
  {
    pattern: /\b(?=[A-Za-z0-9+/_=-]{40,}\b)(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9+/_=-]+\b/u,
    label: "a long token-shaped value",
  },
];
