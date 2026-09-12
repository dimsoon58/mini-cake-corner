import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// Shared backend for every commercial/contact enquiry form on the site —
// replaces the old Web3Forms integration (a placeholder access key,
// "REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY", was never actually configured,
// so every one of these forms failed at submit time with a Web3Forms API
// error). Consolidated onto the same Resend account already used for every
// other transactional email in this codebase — no new external service.
//
// Recipient is fixed to contact@bentocakestudio.ch for every form (never the
// technical-alert admin addresses in _shared/admin-alert.ts — these are
// commercial enquiries, not payment/system alerts). The customer's own
// email is set as reply_to, so replying from the inbox goes straight back to
// them.
//
// Never touches orders / order_items / pending_payments / PostFinance /
// workshop_reservations / Make / Notion — this function reads and writes
// nothing in the database at all.
//
// Every response — success or failure — is HTTP 200 with { success, ... }
// in the body. Deliberate: it makes the outcome unambiguous for the
// frontend (supabase.functions.invoke's own non-2xx error handling varies
// by SDK version and does not reliably surface a JSON body's message), so
// the caller only ever needs to check `result.success`, never guess at
// which layer produced a failure. A genuinely unexpected crash is the only
// path that would ever reach the outer catch below.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CONTACT_RECIPIENT = "contact@bentocakestudio.ch";

function ok(body: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ success: true, ...body }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
  });
}
function fail(message: string): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
  });
}

interface FieldSpec {
  key: string;
  label: string;
  required: boolean;
  maxLen: number;
}

type FormType =
  | "private_workshop"
  | "corporate_celebrations"
  | "corporate_events"
  | "hospitality_partners"
  | "contact";

// One entry per form on the site. Field keys/labels/required-ness mirror
// each form's existing zod schema exactly — this is the server-side
// re-validation of "required fields", never trusting the client alone.
// Subjects are the exact strings the old Web3Forms integration used, kept
// untranslated on purpose (internal admin inbox, not customer-facing) so
// nothing changes for whoever reads that inbox day to day.
const FORM_SPECS: Record<FormType, { subject: string; fields: FieldSpec[] }> = {
  private_workshop: {
    subject: "Private Workshop enquiry, Bento Cake Studio",
    fields: [
      { key: "fullName", label: "First and last name", required: true, maxLen: 150 },
      { key: "email", label: "Email address", required: true, maxLen: 255 },
      { key: "phone", label: "Phone number", required: true, maxLen: 40 },
      { key: "occasion", label: "Occasion", required: false, maxLen: 150 },
      { key: "participants", label: "Number of participants", required: true, maxLen: 50 },
      { key: "preferredDate", label: "Preferred date", required: false, maxLen: 100 },
      { key: "message", label: "Message", required: true, maxLen: 2000 },
    ],
  },
  corporate_celebrations: {
    subject: "Corporate Celebrations enquiry, Bento Cake Studio",
    fields: [
      { key: "firstName", label: "First name", required: true, maxLen: 100 },
      { key: "lastName", label: "Last name", required: true, maxLen: 100 },
      { key: "phone", label: "Phone number", required: true, maxLen: 40 },
      { key: "email", label: "Email address", required: true, maxLen: 255 },
      { key: "companyName", label: "Company name", required: true, maxLen: 200 },
      { key: "numberOfEmployees", label: "Number of employees", required: true, maxLen: 50 },
      { key: "lookingFor", label: "Looking for", required: true, maxLen: 2000 },
    ],
  },
  corporate_events: {
    subject: "Event Quote Request, Bento Cake Studio",
    fields: [
      { key: "fullName", label: "First and last name", required: true, maxLen: 150 },
      { key: "companyAgency", label: "Company / Agency", required: false, maxLen: 200 },
      { key: "email", label: "Email address", required: true, maxLen: 255 },
      { key: "phone", label: "Phone number", required: true, maxLen: 40 },
      { key: "eventDate", label: "Event date", required: true, maxLen: 20 },
      { key: "estimatedGuests", label: "Estimated number of guests", required: true, maxLen: 50 },
      { key: "projectDescription", label: "Project description", required: true, maxLen: 3000 },
    ],
  },
  hospitality_partners: {
    subject: "Hospitality Partners enquiry, Bento Cake Studio",
    fields: [
      { key: "firstName", label: "First name", required: true, maxLen: 100 },
      { key: "lastName", label: "Last name", required: true, maxLen: 100 },
      { key: "phone", label: "Phone number", required: true, maxLen: 40 },
      { key: "email", label: "Email address", required: true, maxLen: 255 },
      { key: "establishmentName", label: "Establishment name", required: true, maxLen: 200 },
      { key: "lookingFor", label: "Looking for", required: true, maxLen: 2000 },
    ],
  },
  contact: {
    subject: "Contact form message, Bento Cake Studio",
    fields: [
      { key: "firstName", label: "First name", required: true, maxLen: 100 },
      { key: "lastName", label: "Last name", required: true, maxLen: 100 },
      { key: "email", label: "Email address", required: true, maxLen: 255 },
      { key: "phone", label: "Phone number", required: true, maxLen: 30 },
      { key: "message", label: "Message", required: true, maxLen: 2000 },
    ],
  },
};

// Attachments — images/PDF only, reasonable per-file and total size caps.
// Base64 inflates size by ~4/3, so the DECODED size is estimated from the
// string length rather than trusted as a client-sent number.
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/pdf",
]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;      // 8 MB per file
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20 MB combined
const MAX_ATTACHMENTS = 6;

interface AttachmentInput {
  filename?: unknown;
  content?: unknown;      // base64, no data: URI prefix
  contentType?: unknown;
}

interface ContactRequestBody {
  formType?: unknown;
  data?: unknown;
  replyToEmail?: unknown;
  botcheck?: unknown; // honeypot — must be empty
  attachments?: unknown;
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// The frontend always sends the already-combined international number
// (country code + local part, via the same combinePhoneNumber() used at
// checkout) — this only re-checks the SHAPE server-side, never trusts it
// blindly. "+" followed by 6-15 digits covers every real country code +
// local number combination without hard-coding a per-country format.
function looksLikeInternationalPhone(value: string): boolean {
  return /^\+\d{6,15}$/.test(value);
}

function estimateBase64Bytes(base64: string): number {
  const clean = base64.replace(/=+$/, "");
  return Math.floor((clean.length * 3) / 4);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ContactRequestBody = await req.json();

    // ── Honeypot ── a real visitor never fills this hidden field. A bot that
    // does gets a normal-looking success response (never told it was
    // caught), but no email is ever actually sent.
    if (typeof body.botcheck === "string" && body.botcheck.trim().length > 0) {
      return ok();
    }

    const formType = body.formType as FormType;
    const spec = FORM_SPECS[formType];
    if (!spec) {
      return fail("Unknown form type.");
    }

    const rawData = (body.data && typeof body.data === "object") ? body.data as Record<string, unknown> : {};

    // ── Server-side required-field validation — never trusts the client's
    // own (zod) validation alone. A missing/empty required field, or any
    // field longer than its sane maximum, rejects the whole request. ──
    const data: Record<string, string> = {};
    for (const field of spec.fields) {
      const raw = rawData[field.key];
      const value = typeof raw === "string" ? raw.trim() : "";
      if (field.required && value.length === 0) {
        return fail(`Missing required field: ${field.label}`);
      }
      if (value.length > field.maxLen) {
        return fail(`Field too long: ${field.label}`);
      }
      data[field.key] = value;
    }

    // Phone: every form spec above includes a "phone" field — always
    // required, so it is always present in `data` by this point. Re-checked
    // for shape (see looksLikeInternationalPhone) — the combining itself
    // (country code + local number) already happened client-side, using the
    // exact same helper as the checkout page.
    if (data.phone && !looksLikeInternationalPhone(data.phone)) {
      return fail("Phone number is not a valid international number.");
    }

    const replyToEmail = typeof body.replyToEmail === "string" ? body.replyToEmail.trim() : "";
    if (!replyToEmail || !isEmailLike(replyToEmail)) {
      return fail("A valid email address is required.");
    }

    // ── Attachments — images/PDF only, size-capped, never trusted blindly ──
    const rawAttachments = Array.isArray(body.attachments) ? body.attachments as AttachmentInput[] : [];
    if (rawAttachments.length > MAX_ATTACHMENTS) {
      return fail(`Too many attachments (max ${MAX_ATTACHMENTS}).`);
    }
    const attachments: { filename: string; content: string }[] = [];
    let totalBytes = 0;
    for (const att of rawAttachments) {
      const filename = typeof att.filename === "string" ? att.filename.trim().slice(0, 200) : "";
      const content = typeof att.content === "string" ? att.content : "";
      const contentType = typeof att.contentType === "string" ? att.contentType.toLowerCase() : "";
      if (!filename || !content) {
        return fail("Invalid attachment.");
      }
      if (!ALLOWED_ATTACHMENT_TYPES.has(contentType)) {
        return fail(`Attachment type not allowed: ${contentType || "unknown"}. Only images and PDF are accepted.`);
      }
      const bytes = estimateBase64Bytes(content);
      if (bytes > MAX_ATTACHMENT_BYTES) {
        return fail(`Attachment too large: ${filename} (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`);
      }
      totalBytes += bytes;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        return fail(`Attachments too large in total (max ${Math.round(MAX_TOTAL_ATTACHMENT_BYTES / (1024 * 1024))} MB).`);
      }
      attachments.push({ filename, content });
    }

    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.error("send-contact-request: RESEND_API_KEY not configured.");
      return fail("Email delivery is not configured. Please try again later or contact us directly.");
    }

    // ── Plain, functional HTML body — one row per non-empty field, in the
    // form's own declared order. Internal admin notification, not a
    // customer-facing branded template. ──
    const rows = spec.fields
      .filter((f) => data[f.key])
      .map((f) => `<tr><td style="padding:6px 12px;color:#888;font-size:14px;vertical-align:top;white-space:nowrap;">${escapeHtml(f.label)}</td><td style="padding:6px 12px;color:#333;font-size:14px;">${escapeHtml(data[f.key]).replace(/\n/g, "<br>")}</td></tr>`)
      .join("");
    const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:Helvetica,Arial,sans-serif;background:#fff;">
      <div style="max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#333;font-size:18px;margin:0 0 16px;">${escapeHtml(spec.subject)}</h2>
        <table style="border-collapse:collapse;width:100%;">${rows}</table>
        <p style="color:#999;font-size:12px;margin-top:20px;">Bento Cake Studio — formulaire du site (reply-to : ${escapeHtml(replyToEmail)})</p>
      </div>
    </body></html>`;

    const emailBody: Record<string, unknown> = {
      from: "contact@bentocakestudio.ch",
      to: [CONTACT_RECIPIENT],
      reply_to: replyToEmail,
      subject: spec.subject,
      html,
    };
    if (attachments.length > 0) emailBody.attachments = attachments;

    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(emailBody),
    });

    let resendData: { id?: string; message?: string } = {};
    try { resendData = await resp.json(); } catch { /* ignore parse error */ }

    // Only ever report success once Resend has genuinely confirmed the send
    // (a real 2xx with an id) — never before, and never on a guess.
    if (!resp.ok || !resendData.id) {
      console.error("send-contact-request: Resend error:", resp.status, resendData);
      return fail("We couldn't send your message right now. Please try again in a moment.");
    }

    return ok({ id: resendData.id });
  } catch (error) {
    console.error("Error in send-contact-request:", error);
    return fail(error instanceof Error ? error.message : "Unknown error");
  }
});
