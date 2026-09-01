import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;

interface SignUpFields {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  birthDate: string;
  password: string;
  newsletterSubscription: boolean;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  // True once a profile fetch has failed and not yet succeeded since — lets
  // a page distinguish "still loading" from "gave up, profile unavailable"
  // instead of showing an infinite spinner on failure.
  profileError: boolean;
  // `code` is Supabase's stable AuthError code (e.g. "invalid_credentials",
  // "email_not_confirmed", "user_already_exists") when present — used by the
  // Login/Signup pages to pick the right message. `error` stays the raw
  // message for logging/fallback; it is never shown verbatim to the user.
  signUp: (fields: SignUpFields) => Promise<{ error: string | null; code: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null; code: string | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: string | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const SITE_URL = "https://dimsoon58.github.io/mini-cake-corner";

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState(false);

  const fetchProfile = async (userId: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error) {
      console.error("Failed to load profile:", error);
      // Previously just returned here, leaving `profile` null forever with
      // no signal that the fetch failed — any page gating on `!profile`
      // alone (e.g. Account.tsx) would spin on "Loading..." indefinitely.
      setProfileError(true);
      return;
    }
    setProfileError(false);
    setProfile(data);
  };

  useEffect(() => {
    let mounted = true;

    // onAuthStateChange fires immediately with the current session on
    // subscribe (in addition to future changes), so this single listener
    // covers both the initial load and every later sign-in/sign-out.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setUser(newSession?.user ?? null);
      if (newSession?.user) {
        fetchProfile(newSession.user.id);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signUp = async ({ firstName, lastName, email, phone, birthDate, password, newsletterSubscription }: SignUpFields) => {
    // Keys here must match exactly what the existing handle_new_user()
    // Supabase trigger reads from auth.users.raw_user_meta_data — do not
    // rename these without checking the trigger definition first.
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${SITE_URL}/login?confirmed=true`,
        data: {
          first_name: firstName,
          last_name: lastName,
          phone,
          birth_date: birthDate,
          newsletter_subscription: newsletterSubscription,
        },
      },
    });
    return { error: error?.message ?? null, code: (error as { code?: string } | null)?.code ?? null };
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null, code: (error as { code?: string } | null)?.code ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${SITE_URL}/reset-password`,
    });
    return { error: error?.message ?? null };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    return { error: error?.message ?? null };
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  return (
    <AuthContext.Provider
      value={{ session, user, profile, loading, profileError, signUp, signIn, signOut, resetPassword, updatePassword, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};
