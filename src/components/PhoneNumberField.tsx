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
import { cn } from "@/lib/utils";

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
  // Presentation-only, optional — every existing caller (Checkout, Contact,
  // the Business.tsx forms) omits this and renders EXACTLY as before
  // ("default": 110px selector). "compact" narrows the country-code
  // selector (still fully legible: flag + dial code + chevron, checked
  // against "+351", the longest code in COUNTRY_CODES) and hands the
  // reclaimed width to the number input, for a form/layout where the
  // default 110px selector leaves too little room to read a full number
  // while typing (currently: PrivateWorkshopDialog.tsx only). No validation
  // or formatting logic is affected either way.
  selectorSize?: "default" | "compact";
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
  selectorSize = "default",
}: PhoneNumberFieldProps) => {
  const compact = selectorSize === "compact";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <div className="flex gap-2">
        <Select value={countryCode} onValueChange={onCountryCodeChange}>
          <SelectTrigger
            className={cn(
              "shrink-0 rounded-none",
              compact ? "w-[96px] gap-1 px-2" : "w-[110px]",
            )}
          >
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
          className={cn("rounded-none", compact && "flex-1 min-w-0")}
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
