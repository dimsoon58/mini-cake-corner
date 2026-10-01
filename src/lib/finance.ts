import { supabase } from "@/integrations/supabase/client";
import type { RefundItem, RefundMethod } from "@/lib/refunds";

// Lot 3 — money figures of one month (finance-month Edge Function, SQL
// admin_finance_month). Shared by the dashboard cards and the Excel export,
// so both always show the same numbers.

export interface FinanceCards {
  collected: number; collectedCount: number;
  refunded: number; refundedCount: number;
  net: number;
  toCollect: number; toCollectCount: number;
  remainingToRefund: number; remainingCount: number;
  undated: number; undatedCount: number;
  toReview: number; toReviewCount: number;
  byOrigin: { website: { collected: number; count: number }; manual: { collected: number; count: number } };
}

export interface FinanceCollection {
  orderId: string; orderNumber: string | null; origin: "website" | "manual"; customer: string;
  isTest: boolean; paidAt: string; paymentMethod: string | null; amount: number;
}

export interface FinanceRefund {
  id: string; orderId: string; orderNumber: string | null; origin: "website" | "manual"; customer: string;
  orderPaidAt: string | null; refundedAt?: string | null; createdAt?: string; amount: number;
  method: RefundMethod | null; methodDetail: string | null; reference: string | null; note: string | null;
  source: string; items: RefundItem[];
}

export interface FinanceLine {
  orderId: string; orderNumber: string | null; origin: "website" | "manual"; customer: string; paidAt: string;
  lineType: "item" | "adjustment"; itemId: string | null; product: string | null; size: string | null; shape: string | null;
  flavors: string[] | null; quantity: number | null; workshopType: string | null; participants: number | null;
  serviceDate: string | null; productionStatus: string | null; amount: number;
  detail: Record<string, number | null> | null;
}

export interface FinanceMonth {
  month: string; from: string; to: string; includeTests: boolean;
  cards: FinanceCards;
  collections: FinanceCollection[];
  refunds: FinanceRefund[];
  undatedRefunds: FinanceRefund[];
  lines: FinanceLine[];
  toCollectList: { orderId: string; orderNumber: string | null; origin: string; customer: string; isTest: boolean; amount: number; createdAt: string }[];
}

export async function fetchFinanceMonth(month: string, includeTests = false): Promise<FinanceMonth> {
  const { data, error } = await supabase.functions.invoke("finance-month", { body: { month, includeTests } });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    let message = "";
    try { message = (await ctx?.json())?.error ?? ""; } catch { /* not JSON */ }
    if (ctx?.status === 404 && !message) throw new Error("La fonction finance-month n'est pas encore déployée.");
    throw new Error(message || "Impossible de charger les chiffres du mois.");
  }
  if (data?.error) throw new Error(String(data.error));
  return data.data as FinanceMonth;
}
