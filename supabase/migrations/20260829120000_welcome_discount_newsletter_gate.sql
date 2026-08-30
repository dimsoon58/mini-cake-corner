-- Decouple the welcome discount from mere account creation and tie it to
-- newsletter subscription status instead. Centralized in a trigger so it
-- applies identically no matter which surface (Signup, Account, Checkout,
-- or any future sync) writes profiles.newsletter_subscription.

-- New accounts no longer get an automatic, running 3-month window — it
-- only starts the day they actually subscribe.
ALTER TABLE public.profiles
  ALTER COLUMN welcome_discount_available SET DEFAULT false;
ALTER TABLE public.profiles
  ALTER COLUMN welcome_discount_expires_at DROP DEFAULT;

-- Centralized rule, keyed only off newsletter_subscription and never
-- touching welcome_discount_used_at itself (that column is exclusively
-- managed by manage-order.ts's approve branch — this function only ever
-- reads it as a hard "never reactivate" gate, never writes it).
CREATE OR REPLACE FUNCTION public.sync_welcome_discount_on_newsletter_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Once actually used, a newsletter toggle must never resurrect it —
  -- checked first, unconditionally.
  IF NEW.welcome_discount_used_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.newsletter_subscription = true THEN
    IF NEW.welcome_discount_expires_at IS NULL THEN
      -- First-ever subscription: the 3-month window starts now.
      NEW.welcome_discount_expires_at := now() + interval '3 months';
      NEW.welcome_discount_available := true;
    ELSIF NEW.welcome_discount_expires_at > now() THEN
      -- Re-subscribing before expiry: reactivate, same deadline, never
      -- pushed back.
      NEW.welcome_discount_available := true;
    ELSE
      -- Re-subscribing after expiry: stays unavailable, deadline untouched.
      NEW.welcome_discount_available := false;
    END IF;
  ELSE
    -- Unsubscribing: deactivate. expires_at is never cleared or changed —
    -- the original 3-month deadline keeps counting down in the background.
    NEW.welcome_discount_available := false;
  END IF;

  RETURN NEW;
END;
$$;

-- Two triggers sharing the same function (INSERT has no OLD row to key a
-- WHEN clause off, so it's split rather than combined) — covers signing up
-- with the newsletter box already checked, and every later toggle.
--
-- IMPORTANT — trigger naming and execution order:
-- Postgres fires same-event triggers in ALPHABETICAL ORDER BY NAME. Both
-- trigger names below start with "trg_w...", which sorts AFTER
-- "trg_protect_profile_financial_fields" ('w' > 'p'). This is deliberate:
-- if a client UPDATE statement only touches newsletter_subscription, the
-- protect trigger runs first, sees no client-submitted change on the
-- welcome_discount_* columns (NEW still equals OLD on those at that point),
-- does nothing — THEN this trigger runs and legitimately sets them. Do not
-- rename either trigger without re-verifying this ordering still holds.
CREATE TRIGGER trg_welcome_discount_newsletter_sync_insert
BEFORE INSERT ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_welcome_discount_on_newsletter_change();

CREATE TRIGGER trg_welcome_discount_newsletter_sync_update
BEFORE UPDATE ON public.profiles
FOR EACH ROW
WHEN (OLD.newsletter_subscription IS DISTINCT FROM NEW.newsletter_subscription)
EXECUTE FUNCTION public.sync_welcome_discount_on_newsletter_change();

-- ── One-time backfill ───────────────────────────────────────────────────
-- Existing profiles that were never subscribed to the newsletter but had
-- welcome_discount_available/expires_at set automatically at account
-- creation, under the OLD rule. Their existing expires_at was computed
-- from account creation, not from a real newsletter subscription — kept
-- as-is, a future first subscription would not get a full fresh 3 months.
-- Confirmed via audit: 5 rows match this condition.
--
-- Explicitly excluded, untouched:
--   - welcome_discount_used_at IS NOT NULL (5 rows) — already spent, never
--     touched, regardless of newsletter status.
--   - newsletter_subscription = true (2 rows) — real, legitimate discount
--     already active under the old rule; kept exactly as-is, including its
--     current expires_at.
--
-- Runs as the migration's own role (postgres/service_role), which
-- trg_protect_profile_financial_fields already allows through — no need to
-- disable it for this statement.
UPDATE public.profiles
SET welcome_discount_available = false,
    welcome_discount_expires_at = NULL
WHERE newsletter_subscription IS NOT TRUE
  AND welcome_discount_used_at IS NULL;
