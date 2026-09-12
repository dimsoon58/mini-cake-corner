// Shared phone-number field: a country-code selector (flag + dial code) next
// to a digits-only local-number input. Extracted verbatim from Checkout.tsx
// (same markup, same classes, same behaviour) so every form on the site —
// checkout included — renders and behaves identically, instead of each
// re-implementing its own version of the same two-part field.
//
// Controlled component: the caller owns `countryCode` / `localPhone` state
// (typically two useState calls) and combines them with combinePhoneNumber()
// from "@/lib/identity" at submit time — this component never combines or
// validates the number itself, it only collects the two parts exactly as
// Checkout.tsx already did.
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { COUNTRY_CODES, sanitizePhoneLocalInput } from "@/lib/identity";

interface PhoneNumberFieldProps {
  countryCode: string;
  onCountryCodeChange: (code: string) => void;
  localPhone: string;
  onLocalPhoneChange: (digits: string) => void;
  id: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
}

export const PhoneNumberField = ({
  countryCode,
  onCountryCodeChange,
  localPhone,
  onLocalPhoneChange,
  id,
  label,
  required = true,
  placeholder = "79 123 45 67",
  error,
}: PhoneNumberFieldProps) => {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="flex gap-2">
        {/* Narrower than the SelectTrigger default (110px -> 96px) with the
            padding/gap tightened to match, so the flag + dial code + chevron
            stay fully legible (checked against "+351", the longest code in
            COUNTRY_CODES) while handing the reclaimed width to the number
            input below, which is the field the customer actually types a
            long value into. */}
        <Select value={countryCode} onValueChange={onCountryCodeChange}>
          <SelectTrigger className="w-[96px] shrink-0 gap-1 px-2 rounded-none">
            <span className="flex items-center gap-1 text-sm leading-none">
              {COUNTRY_CODES.find((c) => c.code === countryCode)?.flag} {countryCode}
            </span>
          </SelectTrigger>
          <SelectContent>
            {COUNTRY_CODES.map((cc) => (
              <SelectItem key={cc.code} value={cc.code}>
                {cc.flag} {cc.code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          className="flex-1 min-w-0 rounded-none"
          value={localPhone}
          onChange={(e) => onLocalPhoneChange(sanitizePhoneLocalInput(e.target.value, countryCode))}
          placeholder={placeholder}
          required={required}
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
};

export default PhoneNumberField;
