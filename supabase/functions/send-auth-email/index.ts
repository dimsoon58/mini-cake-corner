import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Webhook } from "npm:standardwebhooks@1.0.0";

// Supabase Auth Send Email Hook → this function → Resend API → customer.
// Called server-to-server by Supabase itself (signature-verified via
// standardwebhooks, never a user JWT) — enabling this hook in the dashboard
// replaces Auth's SMTP sending entirely, for every email_action_type, so
// this function must never silently drop a type it doesn't explicitly know
// about (see the `default` branch below).

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Bento Cake Studio <contact@bentocakestudio.ch>";
const LOGO_URL = "https://dimsoon58.github.io/mini-cake-corner/logo-new.png";
// Matches AuthConfirm.tsx's route — update this alongside SITE_BASE_URL in
// the other Edge Functions the day bentocakestudio.ch actually goes live.
const SITE_URL = "https://dimsoon58.github.io/mini-cake-corner";

interface HookPayload {
  user: { email: string; new_email?: string };
  email_data: {
    token: string;
    token_hash: string;
    // Only populated for email_change — see the "email_change" case below
    // for why the token/hash pairing is reversed between the two recipients.
    token_new?: string;
    token_hash_new?: string;
    redirect_to: string;
    email_action_type: string;
  };
}

function wrapEmail(bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#fff;">
    <div style="background:linear-gradient(135deg,#1a1a1a,#333);padding:32px;text-align:center;">
      <img src="${LOGO_URL}" alt="Bento Cake Studio" style="height:56px;width:auto;" />
    </div>
    <div style="padding:32px;color:#333;font-size:15px;line-height:1.6;">
      ${bodyHtml}
    </div>
    <div style="background:#fafafa;padding:16px;text-align:center;border-top:1px solid #eee;">
      <p style="color:#aaa;font-size:11px;margin:0;">Bento Cake Studio · Geneva, Switzerland</p>
    </div>
  </div>
</body>
</html>`;
}

function buttonHtml(url: string, label: string): string {
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${url}" style="display:inline-block;background:#1a1a1a;color:#fff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:600;font-size:14px;">${label}</a>
  </div>
  <p style="font-size:12px;color:#888;word-break:break-all;">${url}</p>`;
}

// Reconstructs the same link Supabase's own default {{ .ConfirmationURL }}
// template has always produced — going through Supabase's hosted verify
// endpoint (not our own site), so it keeps establishing a session in the
// browser exactly the way ResetPassword.tsx (and any other page relying on
// this) already expects, unchanged.
function buildVerifyUrl(supabaseUrl: string, tokenHash: string, type: string, redirectTo: string): string {
  const params = new URLSearchParams({ token: tokenHash, type, redirect_to: redirectTo });
  return `${supabaseUrl}/auth/v1/verify?${params.toString()}`;
}

async function sendViaResend(apiKey: string, to: string, subject: string, html: string) {
  const resp = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    console.error("Resend error:", data);
    throw new Error(`Resend error: ${JSON.stringify(data)}`);
  }
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const payloadText = await req.text();
  const headers = Object.fromEntries(req.headers);

  const hookSecret = Deno.env.get("SEND_EMAIL_HOOK_SECRET");
  if (!hookSecret) {
    console.error("SEND_EMAIL_HOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Hook not configured" }), { status: 500 });
  }

  let payload: HookPayload;
  try {
    const wh = new Webhook(hookSecret);
    payload = wh.verify(payloadText, headers) as HookPayload;
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401 });
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return new Response(JSON.stringify({ error: "Email provider not configured" }), { status: 500 });
  }

  const { user, email_data } = payload;
  const { email_action_type, token_hash, token_hash_new, token_new, redirect_to, token } = email_data;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";

  try {
    switch (email_action_type) {
      case "signup": {
        // The one type with a custom page: our own /auth/confirm, verified
        // client-side via supabase.auth.verifyOtp() — see AuthConfirm.tsx.
        const confirmUrl = `${SITE_URL}/auth/confirm?token_hash=${token_hash}&type=email`;
        await sendViaResend(resendApiKey, user.email, "Confirm Your Signup", wrapEmail(`
          <h2 style="margin-top:0;">Welcome to Bento Cake Studio!</h2>
          <p>Please confirm your email address to activate your account.</p>
          ${buttonHtml(confirmUrl, "Confirm your email")}
        `));
        break;
      }

      case "recovery": {
        const resetUrl = buildVerifyUrl(supabaseUrl, token_hash, "recovery", redirect_to);
        await sendViaResend(resendApiKey, user.email, "Reset Your Password", wrapEmail(`
          <h2 style="margin-top:0;">Reset your password</h2>
          <p>We received a request to reset your password. Click below to choose a new one.</p>
          ${buttonHtml(resetUrl, "Reset password")}
          <p style="font-size:12px;color:#888;">If you didn't request this, you can safely ignore this email.</p>
        `));
        break;
      }

      case "email_change": {
        // Secure Email Change ON → two OTPs are present, two emails are
        // required. Per Supabase's docs, the token/hash pairing is REVERSED
        // for backward-compat reasons: the CURRENT address (user.email)
        // verifies with `token` + `token_hash_new`, while the NEW address
        // (user.new_email) verifies with `token_new` + `token_hash`. Mixing
        // these up sends each recipient the other one's link.
        if (token_new && token_hash_new) {
          const currentEmailUrl = buildVerifyUrl(supabaseUrl, token_hash_new, "email_change", redirect_to);
          const newEmailUrl = buildVerifyUrl(supabaseUrl, token_hash, "email_change", redirect_to);

          await sendViaResend(resendApiKey, user.email, "Confirm Your Email Change", wrapEmail(`
            <h2 style="margin-top:0;">Confirm your email change</h2>
            <p>We received a request to change the email address on your account. Click below to confirm from this, your current address.</p>
            ${buttonHtml(currentEmailUrl, "Confirm email change")}
          `));

          if (user.new_email) {
            await sendViaResend(resendApiKey, user.new_email, "Confirm Your New Email", wrapEmail(`
              <h2 style="margin-top:0;">Confirm your new email address</h2>
              ${buttonHtml(newEmailUrl, "Confirm new email")}
            `));
          } else {
            console.error("email_change: Secure Email Change is on but user.new_email is missing — new-address confirmation email not sent.");
          }
        } else {
          // Secure Email Change OFF → a single OTP, sent to the new address.
          const changeUrl = buildVerifyUrl(supabaseUrl, token_hash, "email_change", redirect_to);
          await sendViaResend(resendApiKey, user.new_email || user.email, "Confirm Your New Email", wrapEmail(`
            <h2 style="margin-top:0;">Confirm your new email address</h2>
            ${buttonHtml(changeUrl, "Confirm new email")}
          `));
        }
        break;
      }

      case "magiclink": {
        const magicUrl = buildVerifyUrl(supabaseUrl, token_hash, "magiclink", redirect_to);
        await sendViaResend(resendApiKey, user.email, "Your Sign-In Link", wrapEmail(`
          <h2 style="margin-top:0;">Sign in to Bento Cake Studio</h2>
          ${buttonHtml(magicUrl, "Sign in")}
        `));
        break;
      }

      case "invite": {
        const inviteUrl = buildVerifyUrl(supabaseUrl, token_hash, "invite", redirect_to);
        await sendViaResend(resendApiKey, user.email, "You've Been Invited", wrapEmail(`
          <h2 style="margin-top:0;">You've been invited</h2>
          ${buttonHtml(inviteUrl, "Accept invitation")}
        `));
        break;
      }

      case "reauthentication": {
        // No link here by design — reauthentication is a one-time CODE the
        // user types back into the app, not a clickable link.
        await sendViaResend(resendApiKey, user.email, "Your Verification Code", wrapEmail(`
          <h2 style="margin-top:0;">Your verification code</h2>
          <p style="font-size:28px;letter-spacing:6px;font-weight:700;text-align:center;">${token}</p>
        `));
        break;
      }

      default: {
        // Never silently drop an email type this function doesn't
        // explicitly know about — fall back to the same safe
        // Supabase-hosted verify link used for recovery/email_change/
        // magiclink/invite above, rather than sending nothing.
        console.warn(`Unhandled email_action_type "${email_action_type}" — using generic fallback template.`);
        const genericUrl = buildVerifyUrl(supabaseUrl, token_hash, email_action_type, redirect_to);
        await sendViaResend(resendApiKey, user.email, "Verify Your Email", wrapEmail(`
          <h2 style="margin-top:0;">Verify your email</h2>
          ${buttonHtml(genericUrl, "Verify")}
        `));
      }
    }
  } catch (err) {
    console.error("send-auth-email failed:", err);
    return new Response(JSON.stringify({
      error: err instanceof Error ? err.message : "Unknown error",
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
