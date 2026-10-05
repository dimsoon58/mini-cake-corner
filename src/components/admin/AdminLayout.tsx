import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { BarChart3, Calculator, CakeSlice, CalendarCheck, CalendarDays, ClipboardList, Handshake, Palette, PencilLine, RotateCcw, Sun, UserRoundCog, Users } from "lucide-react";
import Layout from "@/components/Layout";
import { useLang } from "@/context/LanguageContext";
import { useAuth } from "@/context/AuthContext";
import { isAdminEmail } from "@/lib/adminAccess";
import { useStaffRole, type StaffPermission } from "@/lib/staff";
import { cn } from "@/lib/utils";
import { AdminPinGate } from "@/components/admin/AdminPinGate";
import { NewVersionBanner } from "@/components/admin/NewVersionBanner";
import { installAdminSessionTransport } from "@/lib/adminSession";

// The admin PIN session token travels with every admin function call (F16).
installAdminSessionTransport();

// Admin shell: the site Layout plus one menu shared by every Admin page —
// a side menu on large screens, a bottom bar on tablet / phone. Only
// sections that exist are listed; new ones are added here when they ship.
// The menu shows for admins and, since F23, for the employee — who only
// sees her allowed sections and never the admin PIN gate (sign-in /
// access-denied screens keep the plain Layout look).

const ITEMS = [
  { to: "/admin", en: "Today", fr: "Aujourd'hui", short: { en: "Today", fr: "Auj." }, icon: Sun, exact: true },
  { to: "/admin/orders", en: "Orders", fr: "Commandes", short: { en: "Orders", fr: "Cmdes" }, icon: ClipboardList, also: ["/admin/order/"] },
  { to: "/admin/customers", en: "Customers", fr: "Clients", short: { en: "Clients", fr: "Clients" }, icon: Users },
  { to: "/admin/manual-orders", en: "Manual orders", fr: "Commandes manuelles", short: { en: "Manual", fr: "Manu." }, icon: PencilLine },
  { to: "/admin/calendar", en: "Planning", fr: "Planning", short: { en: "Plan.", fr: "Plan." }, icon: CalendarDays, also: ["/admin/labels"] },
  { to: "/admin/workshops", en: "Workshops", fr: "Workshops", short: { en: "Wksp.", fr: "Wksp." }, icon: Palette },
  { to: "/admin/team", en: "Team", fr: "Équipe", short: { en: "Team", fr: "Équipe" }, icon: UserRoundCog },
  { to: "/admin/production", en: "Production", fr: "Production", short: { en: "Prod.", fr: "Prod." }, icon: CakeSlice },
  { to: "/admin/refunds", en: "Refunds", fr: "Remboursements", short: { en: "Refunds", fr: "Remb." }, icon: RotateCcw },
  { to: "/admin/compta", en: "Accounting", fr: "Compta", short: { en: "Acct.", fr: "Compta" }, icon: Calculator },
  { to: "/admin/partners", en: "Partners", fr: "Partenaires", short: { en: "Partners", fr: "Part." }, icon: Handshake },
  { to: "/admin/dashboard", en: "Dashboard", fr: "Tableau de bord", short: { en: "Stats", fr: "Stats" }, icon: BarChart3 },
];

// F23 : sections de l'employée (aucune donnée financière, aucune gestion).
const EMPLOYEE_ITEMS: ((typeof ITEMS)[number] & { perms: StaffPermission[] })[] = [
  { ...ITEMS[0], perms: ["today.view"] },
  { to: "/admin/production", en: "Production", fr: "Production", short: { en: "Prod.", fr: "Prod." }, icon: CakeSlice, perms: ["production.view"] },
  { ...ITEMS[1], perms: ["orders.view"] },
  { to: "/admin/calendar", en: "Planning", fr: "Planning", short: { en: "Plan.", fr: "Plan." }, icon: CalendarDays, perms: ["planning.view"] },
  { to: "/admin/me", en: "My schedule & leave", fr: "Mon planning et congés", short: { en: "Me", fr: "Moi" }, icon: CalendarCheck, perms: ["team.self", "leave.self"] },
];

const AdminLayout = ({ children }: { children: ReactNode }) => {
  const { t } = useLang();
  const { user } = useAuth();
  const { pathname } = useLocation();
  const staff = useStaffRole();
  const admin = isAdminEmail(user?.email);

  if (!admin && !staff.isEmployee) return <Layout>{children}</Layout>;
  const items: (typeof ITEMS)[number][] = admin ? ITEMS : EMPLOYEE_ITEMS.filter((it) => it.perms.some((p) => staff.can(p)));
  // L'employée n'a jamais le PIN administrateur : pas de demande de PIN.
  const Gate = admin ? AdminPinGate : ({ children: c }: { children: ReactNode }) => <>{c}</>;

  const isActive = (it: (typeof ITEMS)[number]) =>
    it.exact
      ? pathname === it.to || pathname === `${it.to}/`
      : pathname === it.to || pathname.startsWith(`${it.to}/`) || (it.also ?? []).some((p) => pathname.startsWith(p));

  return (
    <Layout>
      <NewVersionBanner />
      <Gate>
      <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-2 lg:px-4 pb-20 lg:pb-0">
        {/* Side menu (large screens) */}
        <nav aria-label={t("Admin menu", "Menu Admin")} className="hidden lg:block pt-8">
          <div className="sticky top-28 space-y-1">
            <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{admin ? "Admin" : t("Team", "Équipe")}</p>
            {items.map((it) => {
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
        <div className="flex overflow-x-auto [scrollbar-width:none]">
          {items.map((it) => {
            const Icon = it.icon;
            const active = isActive(it);
            return (
              <Link
                key={it.to}
                to={it.to}
                aria-label={t(it.en, it.fr)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex-[1_0_auto] flex flex-col items-center justify-center gap-0.5 px-0.5 py-2 text-[10px] leading-tight tracking-[-0.02em]",
                  active ? "text-primary font-semibold" : "text-muted-foreground",
                )}
              >
                <Icon className="w-5 h-5 shrink-0" strokeWidth={1.75} />
                <span className="block max-w-full truncate" title={t(it.en, it.fr)}>{t(it.short.en, it.short.fr)}</span>
              </Link>
            );
          })}
        </div>
      </nav>
      </Gate>
    </Layout>
  );
};

export default AdminLayout;
