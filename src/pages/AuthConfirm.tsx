import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type { EmailOtpType } from "@supabase/supabase-js";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { supabase } from "@/integrations/supabase/client";

// Reached from the "Confirm signup" email link, built with Supabase's
// recommended own-domain pattern:
//   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email
// `type` is read from the URL rather than hard-coded so this same route can
// later serve other verifyOtp flows (magic link, email change, ...) without
// any change here — only the email template that points to it decides.
// Does not touch signIn/signUp/AuthContext: verifyOtp() establishes the
// session client-side exactly like a normal sign-in, and onAuthStateChange
// picks it up on its own.
const AuthConfirm = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<"verifying" | "success" | "error">("verifying");
  const hasRun = useRef(false);

  useEffect(() => {
    document.title = "Confirming Email – Bento Cake Studio";
    return () => { document.title = "Bento Cake Studio Geneva"; };
  }, []);

  useEffect(() => {
    // Guards against React 18 StrictMode's dev-only double effect-invoke —
    // a token_hash is single-use, so a second verifyOtp call for the same
    // one would fail even though the first one already succeeded.
    if (hasRun.current) return;
    hasRun.current = true;

    const tokenHash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;

    if (!tokenHash || !type) {
      setStatus("error");
      return;
    }

    supabase.auth.verifyOtp({ token_hash: tokenHash, type }).then(({ error }) => {
      if (error) {
        console.error("Email confirmation failed:", error);
        setStatus("error");
        return;
      }
      setStatus("success");
      navigate("/account", { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "error") {
    return (
      <Layout>
        <main className="max-w-md mx-auto px-6 py-24 text-center">
          <p className="text-sm text-foreground/75 leading-relaxed">
            {t(
              "This confirmation link is invalid or has expired. Please request a new one from the sign-up page.",
              "Ce lien de confirmation est invalide ou a expiré. Merci d'en demander un nouveau depuis la page d'inscription."
            )}
          </p>
        </main>
      </Layout>
    );
  }

  return (
    <Layout>
      <main className="max-w-md mx-auto px-6 py-24 text-center">
        <p className="text-sm text-foreground/75 leading-relaxed">
          {status === "success"
            ? t("Email confirmed! Redirecting...", "Email confirmé ! Redirection...")
            : t("Confirming your email...", "Confirmation de votre email...")}
        </p>
      </main>
    </Layout>
  );
};

export default AuthConfirm;
