// Anti-spam honeypot: an input a real visitor never sees or fills in, but a
// simple bot filling every field in a form will. Shared by every contact/
// enquiry form on the site — one implementation instead of five copies.
// The value is passed straight through to submitContactRequest() as
// `honeypot`; the server (send-contact-request) treats any non-empty value
// as "this is a bot" and skips sending an email, without telling the bot.
interface HoneypotFieldProps {
  value: string;
  onChange: (value: string) => void;
  name?: string;
}

export const HoneypotField = ({ value, onChange, name = "company_website" }: HoneypotFieldProps) => (
  <div aria-hidden="true" style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}>
    <label htmlFor={name}>Leave this field empty</label>
    <input
      id={name}
      name={name}
      type="text"
      tabIndex={-1}
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default HoneypotField;
