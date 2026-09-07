import { useCallback, useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

export interface AddressSelection {
  placeId: string;
  sessionToken: string;
  label: string;
}

interface Suggestion {
  placeId: string;
  primaryText: string;
  secondaryText: string;
  fullText: string;
}

interface Props {
  id?: string;
  disabled?: boolean;
  required?: boolean;
  languageCode?: string;
  placeholder?: string;
  /** Fired when the user picks a real suggestion from the list. */
  onSelect: (selection: AddressSelection) => void;
  /** Fired whenever the field no longer holds a confirmed selection
   *  (user edited the text, cleared it, etc.). */
  onClear: () => void;
}

const DEBOUNCE_MS = 350;
const MIN_CHARS = 4;

const newSessionToken = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

// "Delivery address" field with Google Places (New) autocomplete, proxied
// through the google-places-autocomplete edge function (the API key never
// reaches the browser). The customer must pick a suggestion — free text
// alone never produces a selection, so the checkout can block payment until
// a real address is chosen.
export const DeliveryAddressAutocomplete = ({
  id,
  disabled,
  required,
  languageCode = "fr",
  placeholder,
  onSelect,
  onClear,
}: Props) => {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [hasSelection, setHasSelection] = useState(false);

  const sessionTokenRef = useRef<string>(newSessionToken());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const abortRef = useRef<AbortController>();
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const lastQueryRef = useRef<string>("");

  useEffect(() => {
    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(blurTimeoutRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const runSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < MIN_CHARS) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      // Don't re-query an unchanged string (e.g. focus/blur churn).
      if (trimmed === lastQueryRef.current) return;
      lastQueryRef.current = trimmed;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      try {
        const { data, error } = await supabase.functions.invoke(
          "google-places-autocomplete",
          {
            body: {
              input: trimmed,
              sessionToken: sessionTokenRef.current,
              languageCode,
            },
          },
        );
        if (controller.signal.aborted) return;
        if (error || !data) {
          setSuggestions([]);
        } else {
          setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
          setActiveIndex(-1);
          setOpen(true);
        }
      } catch {
        if (!controller.signal.aborted) setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [languageCode],
  );

  const handleChange = (value: string) => {
    setText(value);
    if (hasSelection) {
      setHasSelection(false);
      onClear();
    }
    setOpen(true);
    clearTimeout(debounceRef.current);
    if (value.trim().length < MIN_CHARS) {
      setSuggestions([]);
      lastQueryRef.current = "";
      return;
    }
    debounceRef.current = setTimeout(() => runSearch(value), DEBOUNCE_MS);
  };

  const handlePick = (suggestion: Suggestion) => {
    setText(suggestion.fullText);
    setSuggestions([]);
    setOpen(false);
    setActiveIndex(-1);
    setHasSelection(true);
    lastQueryRef.current = suggestion.fullText.trim();
    onSelect({
      placeId: suggestion.placeId,
      sessionToken: sessionTokenRef.current,
      label: suggestion.fullText,
    });
    // Start a fresh billing session for the next address lookup.
    sessionTokenRef.current = newSessionToken();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < suggestions.length) {
        e.preventDefault();
        handlePick(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={id}
          value={text}
          disabled={disabled}
          required={required}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          className="rounded-none pl-9"
          placeholder={placeholder}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (suggestions.length > 0) setOpen(true);
          }}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setOpen(false), 150);
          }}
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && suggestions.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto border border-border bg-popover shadow-md"
        >
          {suggestions.map((s, i) => (
            <li
              key={s.placeId}
              role="option"
              aria-selected={i === activeIndex}
              className={cn(
                "cursor-pointer px-3 py-2 text-sm",
                i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
              onMouseDown={(e) => {
                // onMouseDown (not onClick) so the pick fires before the
                // input's onBlur closes the list.
                e.preventDefault();
                handlePick(s);
              }}
              onMouseEnter={() => setActiveIndex(i)}
            >
              <span className="block font-medium text-foreground">{s.primaryText}</span>
              {s.secondaryText && (
                <span className="block text-xs text-muted-foreground">{s.secondaryText}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default DeliveryAddressAutocomplete;
