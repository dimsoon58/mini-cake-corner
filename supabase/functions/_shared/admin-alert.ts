// Plain admin alert e-mail for REAL technical failures in the payment flow
// (not normal card declines). Sent via Resend to the same admins as
// notify-order. Best-effort: never throws into the caller.

const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

export interface TechnicalAlertInput {
  subject: string;
  lines: string[]; // one "Label: value" per line
}

export async function sendTechnicalAlert(input: TechnicalAlertInput): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("sendTechnicalAlert: RESEND_API_KEY not configured — alert skipped:", input.subject);
    return;
  }

  const body = input.lines
    .map((l) => `<tr><td style="padding:4px 12px;font-size:14px;color:#333;">${l}</td></tr>`)
    .join("");

  const html = `<!DOCTYPE html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#fff;">
    <h2 style="color:#b91c1c;font-size:18px;margin:0 0 12px;">⚠️ ${input.subject}</h2>
    <table style="border-collapse:collapse;width:100%;max-width:560px;">${body}</table>
    <p style="color:#999;font-size:12px;margin-top:16px;">Bento Cake Studio — alerte technique paiement</p>
  </body></html>`;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "contact@bentocakestudio.ch",
        to: ADMIN_EMAILS,
        subject: `⚠️ ${input.subject}`,
        html,
      }),
    });
    if (!resp.ok) {
      console.error("sendTechnicalAlert Resend error:", resp.status, await resp.text());
    }
  } catch (e) {
    console.error("sendTechnicalAlert threw:", e);
  }
}
