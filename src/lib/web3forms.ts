/*
 * Web3Forms submission helper.
 *
 * ── SETUP (one time) ────────────────────────────────────────────────
 * 1. Go to https://web3forms.com
 * 2. Enter your email:  contact@bentocakestudio.ch
 * 3. Copy the free "Access Key" they email you.
 * 4. Paste it below, replacing REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY.
 * That's it — every Business form will then be delivered to that inbox.
 * ────────────────────────────────────────────────────────────────────
 */
export const WEB3FORMS_ACCESS_KEY = "REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY";

export const isWeb3FormsConfigured = () =>
  WEB3FORMS_ACCESS_KEY !== "REPLACE_WITH_YOUR_WEB3FORMS_ACCESS_KEY" &&
  WEB3FORMS_ACCESS_KEY.trim().length > 0;

export async function submitToWeb3Forms(
  fields: Record<string, string>,
  options?: { subject?: string; files?: File[] }
): Promise<void> {
  const fd = new FormData();
  fd.append("access_key", WEB3FORMS_ACCESS_KEY);
  fd.append("from_name", "Bento Cake Studio — Website");
  if (options?.subject) fd.append("subject", options.subject);
  fd.append("botcheck", "");

  Object.entries(fields).forEach(([key, value]) => {
    fd.append(key, value ?? "");
  });

  if (options?.files && options.files.length > 0) {
    options.files.slice(0, 6).forEach((file, i) => {
      fd.append(`attachment_${i + 1}`, file, file.name);
    });
  }

  const res = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    body: fd,
  });

  let data: { success?: boolean; message?: string } = {};
  try {
    data = await res.json();
  } catch {
    /* ignore parse error */
  }

  if (!res.ok || !data.success) {
    throw new Error(data.message || "Submission failed. Please try again.");
  }
}
