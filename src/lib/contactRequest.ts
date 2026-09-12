// Shared submission helper for every commercial/contact enquiry form on the
// site (private workshop, corporate celebrations, corporate events,
// hospitality partners, contact page) — all now go through the same
// Supabase Edge Function, send-contact-request, which sends via Resend.
// Replaces the old Web3Forms integration (src/lib/web3forms.ts, removed).
//
// Mirrors the invoke pattern already used elsewhere for a public-facing
// Edge Function (e.g. supabase.functions.invoke("subscribe-newsletter", …)
// in Checkout.tsx) — no special auth setup needed, the anon key already
// attached by the Supabase client is enough.

import { supabase } from "@/integrations/supabase/client";

export type ContactFormType =
  | "private_workshop"
  | "corporate_celebrations"
  | "corporate_events"
  | "hospitality_partners"
  | "contact";

// Same allow-list as the server (supabase/functions/send-contact-request) —
// duplicated here ONLY for an immediate client-side error message before
// even uploading; the server re-validates independently and is the real
// authority (never trust this copy for anything but UX).
const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "application/pdf",
]);
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENTS = 6;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — the server expects raw
      // base64 only.
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export interface ContactRequestOptions {
  files?: File[];
  // Real honeypot value — bound to a hidden input on each form (see e.g.
  // PrivateWorkshopDialog.tsx). Always "" for a genuine visitor; any other
  // value marks the submission as a bot to the server, which then skips
  // sending an email but still returns a normal-looking success.
  honeypot?: string;
}

// Throws a plain Error with a user-facing message on any failure (network,
// server validation, or Resend not confirming delivery) — callers use the
// exact same try/catch + toast.error(err.message) pattern already in place
// on every one of these forms; form data is never touched here, so a caller
// that doesn't call reset() on error keeps everything the customer typed.
export async function submitContactRequest(
  formType: ContactFormType,
  data: Record<string, string>,
  replyToEmail: string,
  options?: ContactRequestOptions,
): Promise<void> {
  const files = options?.files ?? [];
  if (files.length > MAX_ATTACHMENTS) {
    throw new Error(`Please attach at most ${MAX_ATTACHMENTS} files.`);
  }
  for (const file of files) {
    if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      throw new Error(`"${file.name}" is not an accepted file type. Please attach images or a PDF only.`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`"${file.name}" is too large (max ${Math.round(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB).`);
    }
  }

  const attachments = await Promise.all(
    files.map(async (file) => ({
      filename: file.name,
      contentType: file.type,
      content: await fileToBase64(file),
    })),
  );

  const { data: result, error } = await supabase.functions.invoke("send-contact-request", {
    body: {
      formType,
      data,
      replyToEmail,
      botcheck: options?.honeypot ?? "",
      attachments: attachments.length > 0 ? attachments : undefined,
    },
  });

  if (error) {
    throw new Error(error.message || "Submission failed. Please try again.");
  }
  if (!result?.success) {
    throw new Error(result?.error || "Submission failed. Please try again.");
  }
}
