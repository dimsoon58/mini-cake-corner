import { Component, type ErrorInfo, type ReactNode } from "react";

// Global, last-resort safety net (2026-09-14, CI/reliability rollout).
// Catches any otherwise-uncaught error thrown during render anywhere in the
// tree below it (wraps <App /> in main.tsx) — without this, such an error
// unmounts the whole React tree and the customer is left looking at a
// literal blank white page with no explanation (exactly what happened with
// the Catalog/Candles TDZ + missing-import bugs). This is a defence-in-depth
// backstop, not a substitute for the CI checks (tsc/lint/build/smoke tests)
// that should catch this class of bug before it ever reaches production —
// it only exists for whatever slips through anyway.
//
// Deliberately minimal: a class component is the only way React supports
// catching render errors (getDerivedStateFromError / componentDidCatch have
// no hook equivalent). No error-reporting service wired in — logs to
// console only, exactly like an uncaught error already would, so this never
// hides anything from anyone who checks the console/logs. No retry-without-
// reload logic either (a render error can leave app-level state, e.g. React
// Query's cache or context providers, in an inconsistent shape) — a full
// reload is the only genuinely safe recovery.
interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught a render error:", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            padding: "24px",
            textAlign: "center",
            fontFamily: "system-ui, -apple-system, sans-serif",
            background: "#FDF8E1",
            color: "#351E13",
          }}
        >
          <p style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>
            Une erreur est survenue.
          </p>
          <p style={{ fontSize: "14px", color: "#7A6540", margin: 0, maxWidth: "420px" }}>
            Veuillez recharger la page. Si le problème persiste, contactez-nous à{" "}
            <a href="mailto:contact@bentocakestudio.ch" style={{ color: "#78020C" }}>
              contact@bentocakestudio.ch
            </a>
            .
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 24px",
              background: "#78020C",
              color: "#FDF8E1",
              border: "none",
              borderRadius: 0,
              fontSize: "14px",
              cursor: "pointer",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            Recharger la page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
