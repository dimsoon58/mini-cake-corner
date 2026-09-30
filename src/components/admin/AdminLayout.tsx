import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, CakeSlice, CalendarDays, ClipboardList, PencilLine, Sun } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { cn } from "@/lib/utils";

// Admin shell: the site Layout plus one menu shared by every Admin page —
// a side menu on large screens, a bottom bar on tablet / phone. Only
// sections that exist are listed; new ones are added here when they ship.
// The menu shows for admins only (sign-in / access-denied screens keep the
// plain Layout look).

const ITEMS = [
  { to: "/admin", en: "Today", fr: "Aujourd'hui", short: { en: "Today", fr: "Aujourd'hui" }, icon: Sun, exact: true },
  { to: "/admin/orders", en: "Orders", fr: "Commandes", short: { en: "Orders", fr: "Commandes" }, icon: ClipboardList, also: ["/admin/order/"] },
  { to: "/admin/manual-orders", en: "Manual orders", fr: "Commandes manuelles", short: { en: "Manual", fr: "Manuelles" }, icon: PencilLine },
  { to: "/admin/calendar", en: "Planning", fr: "Planning", short: { en: "Planning", fr: "Planning" }, icon: CalendarDays },
  { to: "/admin/production", en: "Production", fr: "Production", short: { en: "Production", fr: "Production" }, icon: CakeSlice },
  { to: "/admin/dashboard", en: "Dashboard", fr: "Tableau de bord", short: { en: "Figures", fr: "Chiffres" }, icon: BarChart3 },
];

const AdminLayout = ({ children }: { children: ReactNode }) => {
  const { t } = useLang();
  const { user } = useAuth();
  const { pathname } = useLocation();

  if (!isAdminEmail(user?.email)) return <Layout>{children}</Layout>;

  const isActive = (it: (typeof ITEMS)[number]) =>
    it.exact
      ? pathname === it.to || pathname === `${it.to}/`
      : pathname === it.to || pathname.startsWith(`${it.to}/`) || (it.also ?? []).some((p) => pathname.startsWith(p));

  return (
    <Layout>
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-2 lg:px-4 pb-20 lg:pb-0">
        {/* Side menu (large screens) */}
        <nav aria-label={t("Admin menu", "Menu Admin")} className="hidden lg:block pt-8">
          <div className="sticky top-28 space-y-1">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Admin</p>
            {ITEMS.map((it) => {
              const Icon = it.icon;
              const active = isActive(it);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 text-sm",
                    active ? "bg-primary/10 text-primary font-semibold" : "text-foreground/80 hover:bg-secondary/60 hover:text-foreground",
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                  {t(it.en, it.fr)}
                </Link>
              );
            })}
          </div>
        </nav>

        <div className="min-w-0">{children}</div>
      </div>

      {/* Bottom bar (tablet / phone) */}
      <nav
        aria-label={t("Admin menu", "Menu Admin")}
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="grid grid-cols-6">
          {ITEMS.map((it) => {
            const Icon = it.icon;
            const active = isActive(it);
            return (
              <Link
                key={it.to}
                to={it.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] leading-tight",
                  active ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5" strokeWidth={1.75} />
                {t(it.short.en, it.short.fr)}
              </Link>
            );
          })}
        </div>
      </nav>
    </Layout>
  );
};

export default AdminLayout;
