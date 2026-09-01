// Shared normalization for customer identity/contact fields (first name,
// last name, email, phone) — used identically in guest checkout, signup,
// and the account page, so the same input never ends up stored in three
// different formats depending on which page it was typed on.

export const COUNTRY_CODES = [
  { code: "+41", country: "CH", flag: "🇨🇭" },
  { code: "+33", country: "FR", flag: "🇫🇷" },
  { code: "+49", country: "DE", flag: "🇩🇪" },
  { code: "+39", country: "IT", flag: "🇮🇹" },
  { code: "+43", country: "AT", flag: "🇦🇹" },
  { code: "+32", country: "BE", flag: "🇧🇪" },
  { code: "+44", country: "UK", flag: "🇬🇧" },
  { code: "+34", country: "ES", flag: "🇪🇸" },
  { code: "+351", country: "PT", flag: "🇵🇹" },
  { code: "+31", country: "NL", flag: "🇳🇱" },
  { code: "+1", country: "US", flag: "🇺🇸" },
];

// Email: always trimmed, always lowercase, before validation or storage.
export function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

// First/last name: each segment (split on space, hyphen, apostrophe) gets
// its first letter capitalised and the rest lowercased —
// "mELODIE" -> "Melodie", "jean-pierre" -> "Jean-Pierre",
// "o'connor" -> "O'Connor". Separators are preserved untouched, so
// multi-word/hyphenated/apostrophe names keep their exact original
// spacing/punctuation (only case changes).
export function normalizeName(rawName: string): string {
  return rawName
    .trim()
    .toLowerCase()
    .split(/([\s'-])/)
    .map((segment) => (/^[\s'-]$/.test(segment) ? segment : segment.charAt(0).toUpperCase() + segment.slice(1)))
    .join("");
}

// Strips everything but digits from what the customer types into the local
// phone field — no spaces, dashes, parentheses, letters, or "+" can ever
// reach state. Also strips a redundant re-typed country code (digits only,
// e.g. "41" for "+41") from the front, so selecting "+41" and then typing
// "+41789275997" collapses to "789275997" instead of doubling the prefix
// when combined later.
export function sanitizePhoneLocalInput(rawInput: string, countryCode: string): string {
  const digitsOnly = rawInput.replace(/\D/g, "");
  const codeDigits = countryCode.replace(/\D/g, "");
  if (codeDigits && digitsOnly.startsWith(codeDigits)) {
    return digitsOnly.slice(codeDigits.length);
  }
  return digitsOnly;
}

// Combines the selected country code with the sanitized local number into
// the single string actually stored — a Swiss-style local number typed
// with its leading "0" (e.g. "079123456") never keeps that 0 once prefixed
// with a country code, so it's dropped here. Unchanged from the rule
// already used at checkout before this change.
export function combinePhoneNumber(countryCode: string, localPhone: string): string {
  return `${countryCode}${localPhone.replace(/^0+/, "")}`;
}

// Splits an already-stored phone number (format not guaranteed — could be
// free-typed from before a country-code selector existed on every page)
// back into { countryCode, localPhone } for prefilling a two-part phone
// field, so prefilling can never produce a double country code. Unchanged
// logic from the original checkout-only splitPhoneForCheckout — only
// relocated here so Signup.tsx and Account.tsx can reuse it too.
export function splitPhoneNumber(rawPhone: string): { countryCode: string | null; localPhone: string } {
  const trimmed = rawPhone.trim();

  // "0041..." is the international "00" form of "+41..." — normalize it to
  // "+41..." so it hits the same case as a "+41"-prefixed value below.
  const normalized = trimmed.startsWith("0041") ? `+41${trimmed.slice(4)}` : trimmed;

  // Match the longest code first so no shorter code can shadow a longer one
  // that starts with the same digits (e.g. "+31" vs "+351").
  const matchedCode = [...COUNTRY_CODES]
    .sort((a, b) => b.code.length - a.code.length)
    .find((cc) => normalized.startsWith(cc.code));

  if (matchedCode) {
    return { countryCode: matchedCode.code, localPhone: normalized.slice(matchedCode.code.length) };
  }

  // Swiss national format: a local number starting with a single 0
  // (e.g. "079 123 45 67") is +41 with the leading 0 dropped.
  if (/^0\d/.test(trimmed)) {
    return { countryCode: "+41", localPhone: trimmed.replace(/^0+/, "") };
  }

  // Unrecognized format — don't guess: pass the value through unchanged and
  // leave the country code selector on whatever it currently is.
  return { countryCode: null, localPhone: trimmed };
}

// Read-only display helper: reformats an already-stored phone number into
// the clean "+41789275997" canonical form (no spaces/dashes, no doubled
// country code), purely for display — never writes anything back. A number
// whose country code can't be recognised is returned merely trimmed, same
// "don't guess" rule as splitPhoneNumber above.
export function formatPhoneForDisplay(rawPhone: string): string {
  const parsed = splitPhoneNumber(rawPhone);
  if (!parsed.countryCode) return rawPhone.trim();
  const digitsOnly = sanitizePhoneLocalInput(parsed.localPhone, parsed.countryCode);
  return combinePhoneNumber(parsed.countryCode, digitsOnly);
}
