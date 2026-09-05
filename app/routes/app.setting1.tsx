import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getStoreOverviewData,
  fetchAndSyncStoreDetails,
  invalidateStoreOverviewCache,
} from "../lib/storeMetrics.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  ShieldCheck,
  Package,
  Clock,
  RefreshCw,
  Star,
  RotateCcw,
  AlertTriangle,
  Check,
  CheckCircle2,
  X,
  Info,
  Lock,
  Calendar,
  Layers,
  type LucideIcon,
} from "lucide-react";

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (!settings || !settings.onboardingCompleted) {
    const url = new URL(request.url);
    return redirect(`/app/onboarding${url.search}`);
  }

  // Read completed orders count directly from DB suppliers and settings
  const suppliers = await prisma.supplier.findMany({
    where: { shop },
    select: { completedOrders: true },
  });
  const suppliersCompleted = suppliers.reduce(
    (sum, v) => sum + (v.completedOrders || 0),
    0
  );

  const completedOrders = Math.max(settings.completedOrdersCount || 0, suppliersCompleted);

  // storeAgeDays: prefer DB value, else compute from storeCreatedAt, else from account creation
  let storeAgeDays = settings.storeAgeDays || 0;
  if (storeAgeDays === 0) {
    const ref = (settings as { storeCreatedAt?: Date | null }).storeCreatedAt ?? settings.createdAt;
    storeAgeDays = Math.max(1, Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)));
  }

  return {
    shop,
    settings,
    completedOrders,
    storeAgeDays,
    lastSynced: settings.updatedAt.toISOString(),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "sync") {
    // 1. Invalidate cache before starting sync
    invalidateStoreOverviewCache(shop);

    // 2. Re-run full data sync (force live sync)
    const storeDetails = await fetchAndSyncStoreDetails(admin, shop);
    const overviewData = await getStoreOverviewData(admin, shop, 0, true);

    const suppliersCompleted = ((overviewData.suppliers as Array<{ completedOrders?: number }>) || []).reduce(
      (sum, v) => sum + (v.completedOrders || 0),
      0
    );

    const currentSettings = await prisma.appSettings.findUnique({
      where: { shop },
      select: { completedOrdersCount: true, storeAgeDays: true },
    });

    const completedOrders = Math.max(
      currentSettings?.completedOrdersCount || 0,
      storeDetails?.completedOrdersCount || 0,
      suppliersCompleted
    );

    const storeAgeDays = Math.max(
      currentSettings?.storeAgeDays || 0,
      storeDetails?.storeAgeDays || 0
    );

    const updated = await prisma.appSettings.update({
      where: { shop },
      data: {
        completedOrdersCount: completedOrders,
        ...(storeAgeDays > 0 ? { storeAgeDays } : {}),
        updatedAt: new Date(),
      },
    });

    // 3. Invalidate cache after sync so Overview page serves fresh data
    invalidateStoreOverviewCache(shop);

    return {
      success: true,
      intent: "sync",
      lastSynced: updated.updatedAt.toISOString(),
      completedOrders,
      storeAgeDays: updated.storeAgeDays || storeAgeDays,
      summary: overviewData.summary,
    };
  }

  const updated = await prisma.appSettings.update({
    where: { shop },
    data: { updatedAt: new Date() },
  });
  invalidateStoreOverviewCache(shop);
  return { success: true, intent: "noop", lastSynced: updated.updatedAt.toISOString() };
};

// Score factors (fixed weights displayed from DB values)
const SCORE_FACTORS = [
  {
    icon: Star,
    label: "Customer Satisfaction",
    desc: "Verified buyer reviews and product CSAT",
    pct: 35,
    color: "#eff6ff",
    iconColor: "#2563eb",
  },
  {
    icon: Package,
    label: "Fulfillment Performance",
    desc: "On-time delivery and order fulfillment rate",
    pct: 20,
    color: "#e0e7ff",
    iconColor: "#4f46e5",
  },
  {
    icon: RotateCcw,
    label: "Return Performance",
    desc: "Return rate and refund handling",
    pct: 20,
    color: "#ecfdf5",
    iconColor: "#059669",
  },
  {
    icon: AlertTriangle,
    label: "Dispute Rate",
    desc: "Dispute rate and chargebacks protection",
    pct: 15,
    color: "#fef3c7",
    iconColor: "#d97706",
  },
  {
    icon: Clock,
    label: "Store History",
    desc: "Account age and sales consistency",
    pct: 10,
    color: "#f3e8ff",
    iconColor: "#9333ea",
  },
];

export default function Setting1() {
  const loaderData = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // ── Initialize from loader ──────────────────────────────────────────
  const [isHowModalOpen, setIsHowModalOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  // Derive live values from fetcher response or loader
  const lastSynced: string =
    (fetcher.data as { lastSynced?: string } | null)?.lastSynced ?? loaderData.lastSynced;

  // Recalculate completedOrders from fetcher sync result if available
  const completedOrders: number =
    (fetcher.data as { completedOrders?: number } | null)?.completedOrders ?? loaderData.completedOrders;

  const storeAgeDays: number =
    (fetcher.data as { storeAgeDays?: number } | null)?.storeAgeDays ?? loaderData.storeAgeDays;

  const isSyncing = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "sync";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data && (fetcher.data as { intent?: string })?.intent === "sync") {
      toast("Store data synchronized successfully!", "success");
    }
  }, [fetcher.state, fetcher.data]);

  // ── Helpers ─────────────────────────────────────────────────────────
  function toast(msg: string, type: "success" | "error" = "success") {
    setToastMessage(msg);
    setToastType(type);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 3500);
  }

  function formatSyncDate(iso: string) {
    try {
      return new Date(iso).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return "Just now";
    }
  }

  // ── Event handlers ──────────────────────────────────────────────────
  function handleSyncNow() {
    fetcher.submit({ intent: "sync" }, { method: "post" });
    toast("Syncing store data...", "success");
  }

  // ── Eligibility progress ────────────────────────────────────────────
  const ordersTarget = 20;
  const ordersPct = Math.min(100, Math.round((completedOrders / ordersTarget) * 100));
  const ageTarget = 30;
  const agePct = Math.min(100, Math.round((storeAgeDays / ageTarget) * 100));
  const ordersMet = completedOrders >= ordersTarget;
  const ageMet = storeAgeDays >= ageTarget;
  const bothMet = ordersMet && ageMet;
  const conditionsMetCount = (ordersMet ? 1 : 0) + (ageMet ? 1 : 0);

  // ── Card Style Tokens ───────────────────────────────────────────────
  const cardStyle: React.CSSProperties = {
    backgroundColor: "#ffffff",
    borderRadius: "14px",
    border: "1px solid #e2e8f0",
    padding: "24px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)",
  };

  const cardIconStyle = (bg: string, color: string): React.CSSProperties => ({
    width: "36px",
    height: "36px",
    borderRadius: "10px",
    backgroundColor: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color,
    flexShrink: 0,
    border: "1px solid rgba(0, 0, 0, 0.04)",
  });

  const lockBadgeStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    backgroundColor: "#f1f5f9",
    color: "#475569",
    fontSize: "11.5px",
    fontWeight: 600,
    padding: "4px 10px",
    borderRadius: "6px",
    border: "1px solid #e2e8f0",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#f1f1f1",
      fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'San Francisco', 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
      color: "#0f172a",
      paddingBottom: "80px",
      letterSpacing: "-0.01em",
    }}>
      {/* ── Toast Notification ───────────────────────────── */}
      {showToast && (
        <div style={{
          position: "fixed",
          bottom: "28px",
          right: "28px",
          backgroundColor: toastType === "error" ? "#dc2626" : "#0f172a",
          color: "#ffffff",
          padding: "12px 20px",
          borderRadius: "10px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.2)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          zIndex: 99999,
          fontSize: "13.5px",
          fontWeight: 500,
        }}>
          {toastType === "error" ? (
            <X size={16} color="#ffffff" />
          ) : (
            <Check size={16} color="#34d399" />
          )}
          <span>{toastMessage}</span>
        </div>
      )}

      {/* ── Main Container ───────────────────────────────── */}
      <div style={{ maxWidth: "1140px", margin: "0 auto", padding: "32px 24px" }}>

        {/* Page Header */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "28px",
          flexWrap: "wrap",
          gap: "16px",
        }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
              <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a", margin: 0, letterSpacing: "-0.025em" }}>
                Settings
              </h1>
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                backgroundColor: "#ecfdf5",
                color: "#059669",
                border: "1px solid #a7f3d0",
                fontSize: "11px",
                fontWeight: 600,
                padding: "2px 8px",
                borderRadius: "6px",
              }}>
                <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#10b981", display: "inline-block" }}></span>
                Live Engine
              </span>
            </div>
            <p style={{ fontSize: "13.5px", color: "#64748b", margin: 0 }}>
              Manage your TrustLayer app preferences.
            </p>
          </div>

          {/* <button
            type="button"
            onClick={() => setIsHowModalOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 15px",
              backgroundColor: "#ffffff",
              border: "1px solid #cbd5e1",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
              color: "#334155",
              cursor: "pointer",
              boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
              transition: "all 0.15s ease",
            }}
             >
            <BookOpen size={14} color="#64748b" />
            <span>How Trust Score is calculated</span>
            <ExternalLink size={12} color="#94a3b8" />
          </button> */}
        </div>

        {/* ── 2-Column Responsive Grid ───────────────────── */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
          gap: "24px",
          alignItems: "start",
        }}>

          {/* ════ LEFT COLUMN ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* 1 · Trust Score Eligibility Card */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={cardIconStyle("#ecfdf5", "#059669")}>
                    <ShieldCheck size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: 0 }}>Trust Score Eligibility</h2>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    backgroundColor: bothMet ? "#ecfdf5" : "#fef3c7",
                    color: bothMet ? "#059669" : "#b45309",
                    fontSize: "11px",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: `1px solid ${bothMet ? "#a7f3d0" : "#fde68a"}`,
                  }}>
                    <span style={{ width: "5px", height: "5px", borderRadius: "50%", backgroundColor: bothMet ? "#10b981" : "#f59e0b" }}></span>
                    {conditionsMetCount} / 2 Met
                  </span>
                  <span style={lockBadgeStyle}>
                    <Lock size={11} />
                    <span>Standardized</span>
                  </span>
                </div>
              </div>

              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "4px 0 16px 0" }}>
                You must meet both requirements to display your Trust Score and badge.
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                
                {/* Requirement: Completed Orders */}
                <EligibilityBar
                  icon={Package}
                  iconBg="#ecfdf5"
                  iconColor="#059669"
                  title="20 completed orders"
                  desc="Minimum number of completed orders required."
                  current={completedOrders}
                  target={ordersTarget}
                  pct={ordersPct}
                  barColor="#10b981"
                />

                {/* Requirement: Store Age */}
                <EligibilityBar
                  icon={Calendar}
                  iconBg="#eff6ff"
                  iconColor="#2563eb"
                  title="30 days store age"
                  desc="Minimum number of days your store must be active."
                  current={storeAgeDays}
                  target={ageTarget}
                  pct={agePct}
                  barColor="#3b82f6"
                />

                {/* Dynamic Status Alert Box */}
                <div style={{
                  backgroundColor: bothMet ? "#f0fdf4" : "#eff6ff",
                  border: `1px solid ${bothMet ? "#86efac" : "#bfdbfe"}`,
                  borderRadius: "8px",
                  padding: "11px 14px",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  fontSize: "12px",
                  color: bothMet ? "#14532d" : "#1e40af",
                  marginTop: "4px",
                  lineHeight: "1.45",
                }}>
                  {bothMet ? (
                    <CheckCircle2 size={15} color="#059669" style={{ flexShrink: 0, marginTop: "1px" }} />
                  ) : (
                    <Info size={15} color="#2563eb" style={{ flexShrink: 0, marginTop: "1px" }} />
                  )}
                  <div>
                    {bothMet
                      ? "Both requirements met. Your Trust Score badge is active on your storefront."
                      : "Both requirements must be met to show your Trust Score and badge on your storefront."}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11.5px", color: "#94a3b8", marginTop: "2px" }}>
                  <Lock size={12} color="#94a3b8" />
                  <span>These requirements are standardized by TrustLayer and cannot be changed.</span>
                </div>

              </div>
            </div>

            {/* 3 · Data Sync Card */}
            <div style={cardStyle}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
                <div style={cardIconStyle("#f1f5f9", "#475569")}>
                  <RefreshCw size={18} />
                </div>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: 0 }}>Data Sync</h2>
                  <p style={{ fontSize: "12.5px", color: "#64748b", margin: "2px 0 0 0" }}>Keep your store data up to date.</p>
                </div>
              </div>

              <div style={{
                borderTop: "1px solid #f1f5f9",
                paddingTop: "18px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "8px",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #e2e8f0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#64748b",
                  }}>
                    <Clock size={16} />
                  </div>
                  <div>
                    <div style={{ fontSize: "12px", color: "#64748b" }}>Last synced</div>
                    <div style={{ fontSize: "13.5px", fontWeight: 700, color: "#0f172a" }}>
                      {formatSyncDate(lastSynced)}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSyncNow}
                  disabled={isSyncing}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "9px 16px",
                    backgroundColor: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                    fontWeight: 600,
                    color: "#0f172a",
                    cursor: isSyncing ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
                    opacity: isSyncing ? 0.7 : 1,
                  }}
                >
                  <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} style={{ animation: isSyncing ? "spin 1s linear infinite" : "none" }} />
                  <span>{isSyncing ? "Syncing..." : "Sync Now"}</span>
                </button>
              </div>

              {isSyncing && (
                <div style={{ marginTop: "14px", fontSize: "12px", color: "#64748b", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#2563eb", display: "inline-block" }}></span>
                  Fetching latest orders, returns, disputes from Shopify...
                </div>
              )}
            </div>

          </div>

          {/* ════ RIGHT COLUMN ════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>

            {/* Trust Score Calculation Card */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={cardIconStyle("#f1f5f9", "#475569")}>
                    <Layers size={18} />
                  </div>
                  <div>
                    <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: 0 }}>Trust Score Calculation</h2>
                  </div>
                </div>
                <span style={lockBadgeStyle}>
                  <Lock size={11} />
                  <span>Standardized</span>
                </span>
              </div>

              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "4px 0 16px 0" }}>
                Your Trust Score is calculated using the following factors.
              </p>

              {/* Multi-segment Weight Visualization Bar */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{
                  width: "100%",
                  height: "8px",
                  borderRadius: "999px",
                  overflow: "hidden",
                  display: "flex",
                  marginBottom: "10px",
                }}>
                  <div style={{ width: "35%", backgroundColor: "#2563eb", height: "100%" }} title="Customer Satisfaction 35%" />
                  <div style={{ width: "20%", backgroundColor: "#4f46e5", height: "100%" }} title="Fulfillment 20%" />
                  <div style={{ width: "20%", backgroundColor: "#059669", height: "100%" }} title="Returns 20%" />
                  <div style={{ width: "15%", backgroundColor: "#d97706", height: "100%" }} title="Disputes 15%" />
                  <div style={{ width: "10%", backgroundColor: "#9333ea", height: "100%" }} title="History 10%" />
                </div>
                
                {/* Visual Legend Tags */}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {[
                    { label: "CSAT", color: "#2563eb" },
                    { label: "Fulfillment", color: "#4f46e5" },
                    { label: "Returns", color: "#059669" },
                    { label: "Disputes", color: "#d97706" },
                    { label: "History", color: "#9333ea" },
                  ].map((l) => (
                    <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#64748b", fontWeight: 500 }}>
                      <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: l.color }} />
                      {l.label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Factor Breakdown Cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
                {SCORE_FACTORS.map((f) => {
                  const FactorIcon = f.icon;
                  return (
                    <div
                      key={f.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "11px 14px",
                        backgroundColor: "#f8fafc",
                        borderRadius: "10px",
                        border: "1px solid #f1f5f9",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{
                          width: "34px",
                          height: "34px",
                          borderRadius: "8px",
                          backgroundColor: f.color,
                          color: f.iconColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}>
                          <FactorIcon size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a" }}>{f.label}</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>{f.desc}</div>
                        </div>
                      </div>
                      <div style={{
                        fontSize: "16px",
                        fontWeight: 800,
                        color: "#0f172a",
                        flexShrink: 0,
                        marginLeft: "8px",
                      }}>
                        {f.pct}%
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Standardized Lock Footer */}
              <div style={{
                backgroundColor: "#f8fafc",
                borderRadius: "8px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "11.5px",
                color: "#64748b",
                border: "1px solid #e2e8f0",
              }}>
                <Lock size={13} color="#64748b" style={{ flexShrink: 0 }} />
                <span>These factors and their weights are standardized by TrustLayer and cannot be modified.</span>
              </div>
            </div>

          </div>
        </div>

        {/* Page Footer */}
        <div style={{
          marginTop: "48px",
          paddingTop: "20px",
          borderTop: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
          color: "#94a3b8",
          flexWrap: "wrap",
          gap: "8px",
        }}>
          <div>TrustLayer v1.0.0</div>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <ShieldCheck size={13} color="#94a3b8" />
            <span>All store trust calculations are cryptographically validated</span>
          </div>
        </div>
      </div>

      {/* ── How Trust Score is Calculated Modal ─────────── */}
      {isHowModalOpen && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.6)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 99999,
          padding: "20px",
        }}>
          <div style={{
            backgroundColor: "#ffffff",
            borderRadius: "16px",
            maxWidth: "600px",
            width: "100%",
            padding: "28px",
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
            maxHeight: "90vh",
            overflowY: "auto",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "8px",
                  backgroundColor: "#eff6ff",
                  color: "#2563eb",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <ShieldCheck size={20} />
                </div>
                <div>
                  <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", margin: 0 }}>
                    How Trust Score is Calculated
                  </h3>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>
                    Standardized Marketplace Trust Algorithm
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsHowModalOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  fontSize: "18px",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: "4px 8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: "13.5px", color: "#475569", lineHeight: "1.6", marginBottom: "20px" }}>
              TrustLayer calculates a weighted, multi-dimensional trust rating (0–100) using 5 standardized factors to ensure verifiable supplier and merchant integrity:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "24px" }}>
              {SCORE_FACTORS.map((f) => {
                const FactorIcon = f.icon;
                return (
                  <div
                    key={f.label}
                    style={{
                      padding: "10px 14px",
                      backgroundColor: "#f8fafc",
                      borderRadius: "8px",
                      border: "1px solid #e2e8f0",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <FactorIcon size={14} color={f.iconColor} />
                      <span style={{ fontSize: "13px", fontWeight: 500, color: "#1e293b" }}>{f.label}</span>
                    </div>
                    <strong style={{ color: f.iconColor, fontSize: "13px" }}>{f.pct}% Weight</strong>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setIsHowModalOpen(false)}
                style={{
                  padding: "10px 20px",
                  backgroundColor: "#0f172a",
                  color: "#ffffff",
                  borderRadius: "8px",
                  border: "none",
                  fontSize: "13.5px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Eligibility Progress Bar Sub-Component ──────────────────────────────────
function EligibilityBar({
  icon: IconComponent,
  iconBg,
  iconColor,
  title,
  desc,
  current,
  target,
  pct,
  barColor,
}: {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  title: string;
  desc: string;
  current: number;
  target: number;
  pct: number;
  barColor: string;
}) {
  const met = current >= target;
  return (
    <div style={{
      backgroundColor: met ? "#f0fdf4" : "#f8fafc",
      borderRadius: "10px",
      border: `1px solid ${met ? "#bbf7d0" : "#f1f5f9"}`,
      padding: "14px 16px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div style={{
            width: "32px",
            height: "32px",
            borderRadius: "8px",
            backgroundColor: iconBg,
            color: iconColor,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <IconComponent size={16} color={iconColor} />
          </div>
          <div>
            <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#0f172a", display: "flex", alignItems: "center", gap: "6px" }}>
              <span>{title}</span>
              {met && (
                <span style={{ fontSize: "11.5px", color: "#059669", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: "3px" }}>
                  <Check size={12} /> Met
                </span>
              )}
            </div>
            <div style={{ fontSize: "11.5px", color: "#64748b" }}>{desc}</div>
          </div>
        </div>
        <div style={{
          fontSize: "15px",
          fontWeight: 700,
          color: met ? "#059669" : "#0f172a",
          flexShrink: 0,
          marginLeft: "8px",
        }}>
          {current} <span style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 500 }}>/ {target}</span>
        </div>
      </div>
      <div style={{ width: "100%", height: "6px", backgroundColor: "#e2e8f0", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          backgroundColor: barColor,
          borderRadius: "999px",
          transition: "width 0.4s ease",
        }} />
      </div>
    </div>
  );
}
