// Plain admin alert e-mail for REAL technical failures in the payment flow
// (not normal card declines). Sent via Resend to the same admins as
// notify-order. Best-effort: never throws into the caller.

const ADMIN_EMAILS = ["naglemelodie@gmail.com", "e.potapushina@gmail.com"];

// Shared cooldown keys/duration for claimAndSendTechnicalAlert, below. Kept
// here (not in order-side-effects.ts) specifically so workshop-make.ts can
// import them without creating a circular module dependency (order-side-
// effects.ts already imports FROM workshop-make.ts).
//
// 24h: long enough that a 15-min retry sweep can never flood the inbox again,
// short enough that an unresolved configuration problem still resurfaces
// daily until fixed (never silently forgotten).
export const ALERT_COOLDOWN_SECONDS = 24 * 60 * 60;
export const MAKE_REPAIR_ALERT_KEY = "make-repair-not-configured";
// Shared by BOTH the workshop-creation sync (order-side-effects.ts) and the
// workshop-cancellation sync (workshop-make.ts) — one missing-URL problem,
// one alert, one cooldown, regardless of which lifecycle event discovers it
// first.
export const WORKSHOP_MAKE_URL_ALERT_KEY = "workshop-make-url-missing";

export interface TechnicalAlertInput {
  subject: string;
  lines: string[]; // one "Label: value" per line
}

// Returns whether the alert was REALLY sent (Resend accepted it, HTTP 2xx) —
// never throws. claimAndSendTechnicalAlert (below) uses this to decide
// whether the DB cooldown claim should stand or be released.
export async function sendTechnicalAlert(input: TechnicalAlertInput): Promise<boolean> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    console.error("sendTechnicalAlert: RESEND_API_KEY not configured — alert skipped:", input.subject);
    return false;
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
      return false;
    }
    return true;
  } catch (e) {
    console.error("sendTechnicalAlert threw:", e);
    return false;
  }
}

// ── Durable, DB-backed de-duplication ───────────────────────────────────────
//
// WHY THIS EXISTS: before this change, every "configuration manquante" alert
// (postMakeRepair / the workshop-Make missing-URL alert in
// order-side-effects.ts) was de-duplicated by a plain `let sent = false`
// module-level variable, commented "once per function instance". That is NOT
// durable — a Supabase Edge Function invoked by a 15-minute pg_cron sweep has
// no guarantee of hitting a warm instance, and in production it did not: on
// the night of 2026-09-11, MAKE_WORKSHOP_WEBHOOK_URL was missing and the
// in-memory flag reset on (almost) every cold cron tick, sending ~42
// "configuration manquante" e-mails until the daily Resend quota was hit.
//
// claim_technical_alert(key, cooldown) — see migration
// 20260912090000_technical_alert_cooldown.sql (NOT YET APPLIED) — is an
// atomic Postgres upsert: it can return true at most once per cooldown
// window, no matter how many concurrent or cold Edge Function instances call
// it. A cold start can NEVER re-arm it early. On any failure to reach the
// cooldown table, this fails CLOSED (alert suppressed) rather than falling
// back to "always send" — a broken cooldown mechanism must never become a
// second way to flood the inbox.
//
// TWO-PHASE, so a Resend failure can never go silently dark for the full
// cooldown: claim_technical_alert stamps last_sent_at (claims the cooldown)
// BEFORE the Resend call, so a crash between claim and send still counts as
// "handled" rather than retried forever — but if sendTechnicalAlert() itself
// reports failure (Resend down / RESEND_API_KEY missing / non-2xx), the
// claim is explicitly released (release_technical_alert_claim) so the NEXT
// caller — bounded by whatever already-throttled cadence calls this function
// (the 15-min retry-order-side-effects sweep, or one real checkout/
// cancellation at a time) — can try again. This does NOT reopen the original
// flood: that bug re-armed on EVERY cold start regardless of outcome; this
// only re-arms after a CONFIRMED send failure, at the caller's own natural
// cadence. And if Resend itself is down, no email reaches an admin inbox
// either way — a burst of failed retries produces extra log lines, never
// extra delivered mail, so there is no user-visible flood risk even in that
// double-fault case.
export async function claimAndSendTechnicalAlert(
  supabase: any,
  key: string,
  cooldownSeconds: number,
  input: TechnicalAlertInput,
): Promise<void> {
  let claimed = false;
  try {
    const { data, error } = await supabase.rpc("claim_technical_alert", {
      p_key: key,
      p_cooldown_seconds: cooldownSeconds,
    });
    if (error) {
      console.error(`claimAndSendTechnicalAlert: claim_technical_alert failed for "${key}" — alert suppressed:`, error);
      return;
    }
    claimed = data === true;
  } catch (e) {
    console.error(`claimAndSendTechnicalAlert: claim_technical_alert threw for "${key}" — alert suppressed:`, e);
    return;
  }
  if (!claimed) return; // still within cooldown — an alert for this key was already CONFIRMED sent recently

  const sent = await sendTechnicalAlert(input);
  if (sent) return;

  // Resend failed — this claim did NOT result in a real alert reaching
  // anyone. Release it so it is immediately retryable, instead of the
  // problem going unreported for the rest of the cooldown window.
  try {
    const { error: relErr } = await supabase.rpc("release_technical_alert_claim", { p_key: key });
    if (relErr) {
      console.error(`claimAndSendTechnicalAlert: release_technical_alert_claim failed for "${key}" — alert stays cooled down until the window expires:`, relErr);
    }
  } catch (e) {
    console.error(`claimAndSendTechnicalAlert: release_technical_alert_claim threw for "${key}":`, e);
  }
}
