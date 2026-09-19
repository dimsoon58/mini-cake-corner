import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle, Clock, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/CartContext";
import { firePurchaseOnce } from "@/lib/analytics";
import { supabase } from "@/integrations/supabase/client";
import { useLang } from "@/context/LanguageContext";
import Layout from "@/components/Layout";
import { clearStoredOrderId } from "@/lib/checkoutOrderId";
import { broadcastOrderCompleted } from "@/lib/orderCompletionChannel";

// Poll confirm-postfinance-payment until it reaches an authoritative outcome.
// ~4s interval; after this many attempts we stop and show a neutral "still
// verifying" screen — the webhook will finish the order server-side.
const MAX_POLLS = 30;
// Per-attempt cap, passed straight to supabase-js's own `timeout` option.
// @supabase/functions-js's FunctionsClient.invoke() builds a REAL
// AbortController for this internally and passes its signal into the
// underlying fetch() call — the network request itself is genuinely
// aborted when this fires, not merely raced against and left running in
// the background. invoke() also catches that abort itself and resolves
// (never rejects) with { data: null, error }, so this alone already turns
// a hang into a normal, countable failure.
//
// 2026-09-19: was 10000 — too tight. confirm-postfinance-payment can
// legitimately take longer than that on a genuinely healthy call (a cold
// Edge Function start, a PostFinance round trip, retryMissingSideEffects
// sending an e-mail inline) — a call that would have succeeded in, say,
// 12s was instead being aborted at 10s and retried from scratch, turning a
// normal few-second confirmation into repeated abort-and-retry cycles that
// took minutes. This is purely a ceiling, never a floor: a call that
// resolves in 3s still resolves in 3s exactly as before — widening it only
// gives a genuinely slow-but-healthy call more room to finish naturally
// instead of being cut off and restarted. The 2-minute GLOBAL_WATCHDOG_MS
// below remains the real, unconditional ceiling on the whole flow.
const CONFIRM_TIMEOUT_MS = 25000;
// Unconditional backstop, independent of any network response ever
// arriving at all: a single setTimeout started once when this page's
// polling begins. It does not depend on invoke()'s own abort working, on
// pollsRef, on the interval, or on anything else — even in a hypothetical
// case where every other safeguard somehow fails, this alone guarantees
// the spinner cannot outlive it.
const GLOBAL_WATCHDOG_MS = 2 * 60 * 1000;

type Phase = "verifying" | "confirmed" | "failed" | "timeout";

type OrderInfo = {
  fulfillmentType: string | null;
  workshopConfirmed: boolean;
  physicalValidation: string | null;
  orderValidation: string | null;
  orderFailureReason: string | null;
};

const PaymentSuccess = () => {
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { clearCart } = useCart();
  // create-postfinance-payment's successUrl is /payment-success?order_id=<orderId>.
  const orderId = searchParams.get("order_id");

  const [phase, setPhase] = useState<Phase>("verifying");
  const [info, setInfo] = useState<OrderInfo | null>(null);
  // A workshop seat sold out between checkout and payment confirmation. Three
  // truthful situations:
  //   rewardOnly                    -> no money was ever taken
  //   refundState === 'to_refund'   -> money received, refund still to process
  //   refundState === 'refunded'    -> money received, refund already done
  const [capacity, setCapacity] = useState<{ rewardOnly: boolean; refundState: string } | null>(null);
  const cartClearedRef = useRef(false);
  const pollsRef = useRef(0);
  // After the order is confirmed we keep polling a few more times so that any
  // side-effect (Make webhook / e-mails) that hasn't been delivered yet gets
  // re-fired server-side — belt-and-suspenders alongside the PostFinance
  // webhook's own retries.
  const sideEffectsDoneRef = useRef(false);
  const nudgeRef = useRef(0);
  const MAX_NUDGES = 8;

  // The cart is cleared ONLY once the payment is really confirmed — never
  // merely because this page rendered (a failed / abandoned payment must keep
  // the cart so the customer can retry). The stored checkout orderId
  // (CHECKOUT_ORDER_ID_KEY, reused by Checkout.tsx across a reload so an
  // outstanding reward reservation is never orphaned — see checkoutOrderId.ts)
  // is cleared alongside it, for the same reason: the payment this orderId
  // was reserving points for is now genuinely, definitively resolved.
  //
  // 2026-09-14: also broadcasts this exact orderId to every OTHER open tab
  // (see orderCompletionChannel.ts) — the original Checkout tab is commonly
  // left behind once PostFinance's payment page opens in a NEW tab
  // (EmbeddedCheckout.tsx's link is target="_blank"), and had no way to
  // learn the order it was showing had already been paid elsewhere. Fired
  // from this exact spot and no other: only once the cart/orderId here have
  // ALREADY been cleared for real, server-confirmed reasons — never on a
  // mere "Proceed to Payment" click, never speculatively.
  useEffect(() => {
    if (phase === "confirmed" && !cartClearedRef.current) {
      cartClearedRef.current = true;
      clearCart();
      clearStoredOrderId();
      if (orderId) broadcastOrderCompleted(orderId);
    }
  }, [phase, clearCart, orderId]);

  useEffect(() => {
    if (!orderId) {
      setPhase("timeout");
      return;
    }
    if (phase === "failed" || phase === "timeout") return;
    if (phase === "confirmed" && (sideEffectsDoneRef.current || nudgeRef.current >= MAX_NUDGES)) return;
    if (capacity) return;

    const id = orderId;
    let mounted = true;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    // Declared before stop() so stop() can clear it too — assigned just
    // below; nothing calls stop() before that assignment runs (confirm()
    // is only ever invoked asynchronously), so there's no ordering hazard.
    let watchdogId: ReturnType<typeof setTimeout> | undefined;
    // Stops EVERYTHING: the polling interval AND the global watchdog. Once
    // stopped, neither can ever fire again for this effect run — no stale
    // watchdog can survive past whatever outcome (confirmed/failed/capacity/
    // timeout) called this.
    const stop = () => {
      if (intervalId !== undefined) clearInterval(intervalId);
      if (watchdogId !== undefined) clearTimeout(watchdogId);
    };
    // Guards against two attempts running at once — a slow/hung attempt
    // must never let a second, overlapping one start on top of it (the
    // 4s tick keeps firing regardless of how long the previous call takes).
    let inFlight = false;

    // Unconditional global watchdog (see GLOBAL_WATCHDOG_MS above). Set up
    // exactly once when this effect starts (i.e. once when the page begins
    // polling — while genuinely stuck in "verifying", none of [orderId,
    // phase, capacity] ever change, so this effect never re-runs and this
    // timer is never re-armed). Fires purely from wall-clock time; it does
    // not read pollsRef, does not know about inFlight, and does not care
    // whether any invoke() call ever settles — it is the one guarantee that
    // cannot be defeated by network behaviour.
    //
    // Stale-closure safety: `phase` here is the value captured when THIS
    // effect run started — but that's exactly right, not a bug: the only
    // way this effect run's `phase` closure could be outdated is if `phase`
    // state actually changed, and `phase` is a dependency of this effect,
    // so a real change already re-ran this effect's cleanup (stop(), via
    // the return function below) and cancelled THIS watchdog before a new
    // one was created for the new phase. On top of that, every place that
    // reaches a real outcome (confirmed/failed/capacity) cancels the
    // watchdog immediately and explicitly too (see below) — it is never
    // left to this closure check alone.
    watchdogId = setTimeout(() => {
      if (!mounted) return;
      // "failed"/"timeout" already returned before this effect ever set up
      // this timer (see the early-returns above) — "confirmed" is the only
      // other outcome worth checking for here.
      if (phase !== "confirmed") {
        setPhase("timeout");
      }
      stop();
    }, GLOBAL_WATCHDOG_MS);

    // Every failure path (returned error, thrown exception) converges here:
    // count it, and once MAX_POLLS is reached, stop for good and hand off
    // to the calmer "still verifying" screen — never spin past that
    // ceiling, never re-attempt in a tight loop. The watchdog above is the
    // backstop for this same outcome independent of pollsRef altogether.
    const giveUpIfExhausted = () => {
      if (phase !== "confirmed" && pollsRef.current >= MAX_POLLS) {
        setPhase("timeout");
        stop();
      }
    };

    const confirm = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        if (phase === "confirmed") {
          nudgeRef.current += 1;
          if (sideEffectsDoneRef.current || nudgeRef.current > MAX_NUDGES) { stop(); return; }
        } else {
          pollsRef.current += 1;
        }

        // `timeout` genuinely aborts the underlying fetch after
        // CONFIRM_TIMEOUT_MS (see the constant's own comment above) —
        // invoke() itself catches that abort and resolves normally with
        // { data: null, error }, so a hang becomes an ordinary, countable
        // failure below, exactly like any other error response.
        const { data, error } = await supabase.functions.invoke("confirm-postfinance-payment", {
          body: { orderId: id },
          timeout: CONFIRM_TIMEOUT_MS,
        });

        if (!mounted) return;

        if (error) {
          console.error("Error confirming payment:", error);
          giveUpIfExhausted();
          return;
        }

        if (data?.reason === "workshop_capacity_unavailable") {
          const rewardOnly = !!data.rewardOnly;
          const refundState: string = data.refundState
            ?? (data.refundResolved || data.financiallyResolved ? "refunded" : "to_refund");
          setCapacity({ rewardOnly, refundState });
          stop();
          return;
        }

        if (data?.confirmed === true) {
          firePurchaseOnce(id);
          setInfo({
            fulfillmentType: data.fulfillmentType ?? null,
            workshopConfirmed: !!data.workshopConfirmed,
            physicalValidation: data.physicalValidation ?? null,
            orderValidation: data.orderValidation ?? "pending",
            orderFailureReason: data.orderFailureReason ?? null,
          });
          if (data.sideEffectsComplete !== false) {
            sideEffectsDoneRef.current = true;
            stop();
          } else if (watchdogId !== undefined) {
            // Still nudging for a few more cycles below (see MAX_NUDGES) —
            // the interval must keep running for that, but the watchdog's
            // only job (bounding the "verifying" spinner) is already done
            // the instant we know the order is confirmed, regardless of
            // whether side-effect nudging continues. Cancelled on its own,
            // without touching the interval stop() would also clear.
            clearTimeout(watchdogId);
            watchdogId = undefined;
          }
          setPhase("confirmed");
          return;
        }

        if (data?.failed === true) {
          setPhase("failed");
          stop();
          return;
        }

        // Not confirmed (still finalising / non-terminal state), not failed —
        // keep polling until the cap, then hand off to the server-side webhook.
        giveUpIfExhausted();
      } catch (e) {
        // invoke() itself never throws (it catches its own abort/network
        // failures and resolves with { error } instead — see above), but
        // anything else unexpected in this block still lands here: treated
        // exactly like a returned `error`, counted, never silently
        // swallowed, and capped by the same MAX_POLLS ceiling — on top of
        // the unconditional watchdog above, which doesn't even need this
        // catch to run at all.
        if (!mounted) return;
        console.error("confirm-postfinance-payment threw:", e);
        giveUpIfExhausted();
      } finally {
        inFlight = false;
      }
    };

    confirm();
    intervalId = setInterval(confirm, 4000);

    // Mobile browsers throttle setInterval heavily in a backgrounded tab
    // (e.g. the customer switching away to check the "order received"
    // e-mail that just arrived) — the poll can then lag far behind wall-
    // clock time even though the server finished in seconds. Firing an
    // immediate check the moment the tab becomes visible again means the
    // page catches up instantly instead of waiting for the throttled timer
    // to resume on its own.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") confirm();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      mounted = false;
      stop(); // clears both intervalId and watchdogId
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [orderId, phase, capacity]);

  // ── Confirmed-screen wording, by order shape ──────────────────────────
  // 2026-09-15 (deferred capture restored): reaching this "confirmed" phase
  // only ever means the PostFinance AUTHORIZATION succeeded — the money is
  // blocked/reserved on the customer's payment method, NOT captured, and the
  // order is awaiting the admin's Accept/Refuse decision for every
  // fulfilment type now (workshop_only included — no more auto-confirm).
  // Wording here must never claim the payment was received/captured, the
  // order is definitively confirmed, or a workshop seat is confirmed, until
  // that admin decision has actually happened (nothingPending below).
  // A capacity abort persisted order_validation='cancelled' — treated in its
  // own branch below, never here.
  const ft = info?.fulfillmentType;
  const isWorkshopOnly = ft === "workshop_only";
  const isMixed = ft === "mixed";
  // "fully done, nothing pending" = the admin actually Accepted the order
  // (whole-order decision — see manage-order/index.ts). workshop_only has no
  // physical_validation of its own (stays 'not_applicable'); its decision is
  // recorded directly on orderValidation instead.
  const nothingPending = isWorkshopOnly
    ? info?.orderValidation === "approved"
    : info?.physicalValidation === "approved";

  const headline = nothingPending
    ? t("Order Confirmed", "Commande confirmée")
    : t("Request received", "Demande reçue");

  let bodyText: string;
  let panelTitle: string;
  let panelText: string;
  if (isWorkshopOnly) {
    bodyText = nothingPending
      ? t(
          "Your payment has been received and your workshop booking is confirmed.",
          "Votre paiement a bien été reçu et votre réservation d'atelier est confirmée.",
        )
      : t(
          "Your workshop booking request has been received. Your seat is being held while we confirm it — nothing has been charged yet.",
          "Votre demande de réservation d'atelier a bien été reçue. Votre place est retenue pendant que nous confirmons votre réservation — aucun montant n'a encore été prélevé.",
        );
    panelTitle = nothingPending
      ? t("Workshop confirmed", "Atelier confirmé")
      : t("Workshop booking pending confirmation", "Réservation d'atelier en attente de confirmation");
    panelText = nothingPending
      ? t(
          "You will receive a confirmation e-mail with the date, time and practical details of your workshop.",
          "Vous recevrez un e-mail de confirmation avec la date, l'heure et les informations pratiques de votre atelier.",
        )
      : t(
          "We will confirm your booking within the next 24 hours. Only once confirmed will your payment be taken and you will receive a confirmation e-mail.",
          "Nous confirmerons votre réservation dans les 24 heures. Ce n'est qu'une fois confirmée que votre paiement sera prélevé et que vous recevrez un e-mail de confirmation.",
        );
  } else if (isMixed) {
    bodyText = nothingPending
      ? t(
          "Your payment has been received. Your order — workshop and cake / products — is now confirmed.",
          "Votre paiement a bien été reçu. Votre commande — atelier et gâteau / produits — est maintenant confirmée.",
        )
      : t(
          "Your order request has been received. It is now awaiting validation by Bento Cake Studio — nothing has been charged yet.",
          "Votre demande de commande a bien été reçue. Elle est maintenant en attente de validation par Bento Cake Studio — aucun montant n'a encore été prélevé.",
        );
    panelTitle = nothingPending
      ? t("Order confirmed", "Commande confirmée")
      : t("Order pending approval", "Commande en attente de validation");
    panelText = nothingPending
      ? t("We're excited to create something special for you!", "Nous avons hâte de créer quelque chose de spécial rien que pour vous !")
      : t(
          "We will review your whole order — workshop and cake / products together — and send you a confirmation within the next 24 hours. Only once confirmed will your payment be taken.",
          "Nous examinons votre commande dans son ensemble — atelier et gâteau / produits — et vous enverrons une confirmation dans les 24 heures. Ce n'est qu'une fois confirmée que votre paiement sera prélevé.",
        );
  } else {
    // cake_only
    bodyText = nothingPending
      ? t(
          "Your order has been placed and your payment has been received. We are now preparing your order.",
          "Votre commande a bien été enregistrée et votre paiement a bien été reçu. Nous préparons dès à présent votre commande.",
        )
      : t(
          "Your order request has been received. It is now awaiting validation by Bento Cake Studio — nothing has been charged yet.",
          "Votre demande de commande a bien été reçue. Elle est maintenant en attente de validation par Bento Cake Studio — aucun montant n'a encore été prélevé.",
        );
    panelTitle = nothingPending
      ? t("Preparing Your Order", "Préparation de votre commande")
      : t("Order Pending Approval", "Commande en attente de validation");
    panelText = nothingPending
      ? t("We're excited to create something special for you!", "Nous avons hâte de créer quelque chose de spécial rien que pour vous !")
      : t(
          "We will confirm your order within the next 24 hours with the details of your pickup or delivery date and time. Only once confirmed will your payment be taken. If we cannot fulfil it, the authorization will simply be released.",
          "Nous vous confirmerons votre commande dans les 24 heures, en précisant la date et l'heure de votre retrait ou de votre livraison. Ce n'est qu'une fois confirmée que votre paiement sera prélevé. Si nous ne pouvons pas la réaliser, l'autorisation sera simplement annulée.",
        );
  }

  return (
    <Layout>
      <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
        <div className="bg-card shadow-md p-8">
          {capacity ? (
            <>
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Workshop No Longer Available", "Atelier plus disponible")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {capacity.rewardOnly
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed. No order was placed and nothing was charged (your reward balance has been released). Please choose another session.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement. Aucune commande n'a été enregistrée et aucun montant n'a été prélevé (votre cagnotte a été libérée). Merci de choisir une autre session."
                    )
                  // 2026-09-15 (deferred capture): the normal case now — nothing
                  // was ever captured, so nothing is ever "refunded"/"pending
                  // refund" here. The "refunded" / "to_refund" branches below
                  // are kept only for backward compatibility with an order
                  // that went through this exact path under the old
                  // immediate-capture model (money genuinely already taken) —
                  // never reachable for a new authorization-only checkout.
                  : capacity.refundState === "refunded"
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your order could not be fulfilled. Your payment was received and has already been refunded. Please contact us if you have any question.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre commande n'a donc pas pu aboutir. Votre paiement a bien été reçu et a déjà été remboursé. Contactez-nous pour toute question."
                    )
                  : capacity.refundState === "to_refund"
                  ? t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your order could not be fulfilled. Your payment has been received and a refund is being processed by our team — you do not need to do anything. Please contact us if you have any question.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre commande n'a donc pas pu aboutir. Votre paiement a bien été reçu et un remboursement est en cours de traitement par notre équipe — vous n'avez rien à faire. Contactez-nous pour toute question."
                    )
                  : t(
                      "The remaining seats for this workshop were booked while your payment was being processed, so your order could not be fulfilled. Nothing was charged — the authorization on your payment method has been released. Please contact us if you have any question.",
                      "Les dernières places de cet atelier ont été réservées pendant le traitement de votre paiement ; votre commande n'a donc pas pu aboutir. Aucun montant n'a été prélevé — l'autorisation sur votre moyen de paiement a été annulée. Contactez-nous pour toute question."
                    )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : phase === "failed" ? (
            <>
              <XCircle className="w-16 h-16 text-destructive mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Payment Not Completed", "Paiement non abouti")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment could not be finalised and nothing was charged. Your cart has been saved. You can try again.",
                  "Votre paiement n'a pas pu être finalisé et aucun montant n'a été prélevé. Votre panier a été conservé. Vous pouvez réessayer."
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button onClick={() => navigate("/checkout")}>
                  {t("Retry payment", "Réessayer le paiement")}
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : phase === "verifying" ? (
            <>
              <Loader2 className="w-16 h-16 text-primary mx-auto mb-6 animate-spin" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Confirming your payment", "Confirmation de votre paiement")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Please wait a moment while we confirm your payment. Do not close this page.",
                  "Merci de patienter un instant pendant que nous confirmons votre paiement. Ne fermez pas cette page."
                )}
              </p>
            </>
          ) : phase === "timeout" ? (
            <>
              <Clock className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {t("Payment is being verified", "Paiement en cours de vérification")}
              </h1>
              <p className="text-muted-foreground mb-8">
                {t(
                  "Your payment is taking a little longer than usual to confirm. You do not need to pay again — we are finalising it and you will receive a confirmation e-mail shortly. Please contact us if you have any doubt.",
                  "La confirmation de votre paiement prend un peu plus de temps que d'habitude. Vous n'avez pas besoin de payer à nouveau — nous le finalisons et vous recevrez un e-mail de confirmation sous peu. Contactez-nous en cas de doute."
                )}
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-2">
                <Button variant="outline" asChild>
                  <Link to="/contact">{t("Contact us", "Nous contacter")}</Link>
                </Button>
              </div>
            </>
          ) : (
            // 2026-09-15: mixed orders now render through this SAME unified
            // block as cake_only/workshop_only (headline/bodyText/panelTitle/
            // panelText, all isMixed-aware — see above). The previous
            // dedicated mixed screen unconditionally showed "Workshop
            // confirmed" as its own always-settled status box, which was only
            // ever true under the old immediate-capture model (the workshop
            // auto-confirmed independently of the cake decision). Under
            // deferred capture, Accept/Refuse is ONE whole-order decision —
            // before it, neither part is confirmed; after it, both are
            // together — so a single status block is now the correct
            // representation, not two independently-worded ones.
            <>
              <CheckCircle className="w-16 h-16 text-primary mx-auto mb-6" />
              <h1 className="text-sm font-sans font-medium uppercase tracking-widest text-foreground mb-4">
                {headline}
              </h1>

              <p className="text-muted-foreground mb-6">{bodyText}</p>

              <div className="bg-muted border border-border p-4 mb-6">
                <div className="flex items-center justify-center gap-2 mb-2">
                  {nothingPending ? (
                    <Sparkles className="w-5 h-5 text-primary" />
                  ) : (
                    <Clock className="w-5 h-5 text-primary" />
                  )}
                  <p className="font-medium text-foreground">{panelTitle}</p>
                </div>
                <p className="text-sm text-muted-foreground">{panelText}</p>
              </div>

              <p className="text-muted-foreground mb-8">
                {t("You may close this page.", "Vous pouvez fermer cette page.")}
              </p>
            </>
          )}

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Button asChild>
              <Link to="/">
                {phase === "confirmed" && !capacity && isMixed
                  ? t("BACK TO HOME", "RETOUR À L'ACCUEIL")
                  : t("Back to Home", "Retour à l'accueil")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/catalog">
                {phase === "confirmed" && !capacity && isMixed
                  ? t("CONTINUE SHOPPING", "CONTINUER MES ACHATS")
                  : t("New Order", "Nouvelle commande")}
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </Layout>
  );
};

export default PaymentSuccess;
