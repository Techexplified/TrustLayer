import { useState, useRef, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { redirect, useLoaderData, useSearchParams, useNavigation, useLocation, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStoreOverviewData, getMarketplaceBenchmarkData } from "../lib/storeMetrics.server";
import type { CollectedVendorData } from "../lib/vendorCollector.server";
import {
  getStoreAiSuggestions,
  generateInitialStoreAiSuggestions,
  regenerateStoreAiSuggestions,
  type PerformanceAiData,
  type StoreMetricsSnapshot,
} from "../lib/aiAdvisor.server";
import {
  Info,
  X,
  Star,
  Package,
  RotateCcw,
  ShieldCheck,
  Clock,
  Lock,
  CheckCircle2,
  TrendingUp,
  Sparkles,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "generate_ai_suggestions" || intent === "regenerate_ai_suggestions") {
    const range = (formData.get("range") as "7d" | "30d" | "90d") || "7d";
    const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;

    const [data, benchmark] = await Promise.all([
      getStoreOverviewData(admin, shop, days),
      getMarketplaceBenchmarkData(),
    ]);

    const settings = data.settings;
    const summary = data.summary;
    const suppliers = data.suppliers || [];

    const totalCompletedOrders = suppliers.reduce((acc, s) => acc + s.completedOrders, 0);
    const totalOrdersScored = totalCompletedOrders;
    const totalReturnsCount = suppliers.reduce((acc, s) => acc + s.refundedUnitsCount, 0);
    const totalDisputesCount = suppliers.reduce((acc, s) => acc + s.disputedOrdersCount, 0);
    const avgFulfillmentHoursList = suppliers.filter(s => s.avgFulfillmentHours > 0).map(s => s.avgFulfillmentHours);
    const avgFulfillmentHours = avgFulfillmentHoursList.length > 0
      ? (avgFulfillmentHoursList.reduce((a, b) => a + b, 0) / avgFulfillmentHoursList.length)
      : 0;

    const hasCompletedOrders = totalCompletedOrders > 0;
    const fulfillmentScore =
      summary?.onTimeDeliveryRate !== null && summary?.onTimeDeliveryRate !== undefined
        ? summary.onTimeDeliveryRate
        : hasCompletedOrders
        ? 100
        : null;

    const overallScore = summary?.marketplaceTrustScore ?? null;

    const snapshot: StoreMetricsSnapshot = {
      storeName: settings?.storeName || undefined,
      shop,
      overallScore,
      marketAvgScore: benchmark?.avgTrustScore ?? 75,
      csatRating: summary?.csatRating ?? null,
      totalReviewCount: suppliers.reduce((acc, s) => acc + (s.totalReviewCount || 0), 0),
      onTimeDeliveryRate: fulfillmentScore,
      avgFulfillmentHours,
      pendingOrders: Math.max(0, totalOrdersScored - totalCompletedOrders),
      returnRate: summary?.returnRate || 0,
      totalReturnsCount,
      disputeRate: summary?.disputeRate || 0,
      totalDisputesCount,
      storeAgeDays: settings?.storeAgeDays || 0,
      suppliers: suppliers.map((s) => ({
        vendorName: s.vendorName,
        trustScore: s.trustScore,
        status: s.status,
        returnRate: s.returnRate,
        onTimeDeliveryRate: s.onTimeDeliveryRate,
      })),
    };

    if (intent === "generate_ai_suggestions") {
      const result = await generateInitialStoreAiSuggestions(shop, snapshot);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, aiData: result.data };
    } else {
      const result = await regenerateStoreAiSuggestions(shop, snapshot);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, aiData: result.data };
    }
  }

  return { success: false, error: "Invalid intent" };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Check if user exists in DB and if onboarding is already completed
  const existingSettings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (!existingSettings || !existingSettings.onboardingCompleted) {
    const url = new URL(request.url);
    return redirect(`/app/onboarding${url.search}`);
  }

  const url = new URL(request.url);
  const range = (url.searchParams.get("range") as "7d" | "30d" | "90d") || "7d";
  const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;

  try {
    const [data, benchmark, aiData] = await Promise.all([
      getStoreOverviewData(admin, shop, days),
      getMarketplaceBenchmarkData(),
      getStoreAiSuggestions(shop),
    ]);

    return {
      shop,
      settings: data.settings,
      suppliers: data.suppliers || [],
      summary: data.summary,
      selectedRange: range,
      benchmark,
      aiData,
    };
  } catch (error) {
    console.error("Error loading performance data:", error);
    const benchmark = await getMarketplaceBenchmarkData();
    return {
      shop,
      settings: null,
      suppliers: [] as CollectedVendorData[],
      summary: null,
      selectedRange: range,
      benchmark,
      aiData: {
        shop,
        suggestions: [],
        isGenerated: false,
        regenerationCount: 0,
        maxRegenerations: 5,
        source: "FALLBACK" as const,
      },
    };
  }
};

export default function PerformancePage() {
  const { shop, settings, summary, suppliers, selectedRange, benchmark, aiData: initialAiData } = useLoaderData<typeof loader>();
  const aiFetcher = useFetcher<{ success: boolean; aiData?: PerformanceAiData; error?: string }>();
  const activeAiData = aiFetcher.data?.aiData || initialAiData;
  const isRegenerating = aiFetcher.state === "submitting" || aiFetcher.state === "loading";
  const regenerationCount = activeAiData?.regenerationCount ?? 0;
  const isRegenLimitReached = regenerationCount >= 5;
  const [regenError, setRegenError] = useState<string | null>(null);

  useEffect(() => {
    if (aiFetcher.data && !aiFetcher.data.success && aiFetcher.data.error) {
      setRegenError(aiFetcher.data.error);
    } else if (aiFetcher.data?.success) {
      setRegenError(null);
    }
  }, [aiFetcher.data]);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const isDateRangeLoading =
    (navigation.state === "loading" || navigation.state === "submitting") &&
    navigation.location != null &&
    navigation.location.pathname === location.pathname &&
    Boolean(new URLSearchParams(navigation.location.search).get("range"));

  // Read pending range only during in-page date range transitions
  const pendingRange = isDateRangeLoading && navigation.location
    ? (new URLSearchParams(navigation.location.search).get("range") as "7d" | "30d" | "90d")
    : null;

  const dateRange =
    pendingRange ||
    (searchParams.get("range") as "7d" | "30d" | "90d") ||
    selectedRange ||
    "7d";

  const dateLabel =
    dateRange === "7d"
      ? "Last 7 days"
      : dateRange === "90d"
      ? "Last 90 days"
      : "Last 30 days";
  const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
  const [compareToMarketplace, setCompareToMarketplace] = useState(true);
  const [trendTimeframe, setTrendTimeframe] = useState<"7d" | "30d" | "90d">("7d");
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
  const [isScoreModalOpen, setIsScoreModalOpen] = useState(false);

  const dateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dateMenuRef.current && !dateMenuRef.current.contains(event.target as Node)) {
        setIsDateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleDateRangeSelect = (r: "7d" | "30d" | "90d") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("range", r);
      return next;
    });
    setTrendTimeframe(r);
    setIsDateMenuOpen(false);
  };

  // Compute live / real values based on store and vendor data for the selected period
  const totalCompletedOrders = suppliers.reduce((acc: number, s: CollectedVendorData) => acc + s.completedOrders, 0);
  const totalOrdersScored = totalCompletedOrders;
  const totalReturnsCount = suppliers.reduce((acc: number, s: CollectedVendorData) => acc + s.refundedUnitsCount, 0);
  const totalDisputesCount = suppliers.reduce((acc: number, s: CollectedVendorData) => acc + s.disputedOrdersCount, 0);
  const totalProductsCount = suppliers.reduce((acc: number, s: CollectedVendorData) => acc + s.totalProducts, 0);

  const avgFulfillmentHoursList = suppliers.filter(s => s.avgFulfillmentHours > 0).map(s => s.avgFulfillmentHours);
  const avgFulfillmentHours = avgFulfillmentHoursList.length > 0
    ? (avgFulfillmentHoursList.reduce((a, b) => a + b, 0) / avgFulfillmentHoursList.length)
    : 0;

  // Period trust score strictly computed for selected timeframe (null if 0 completed orders)
  const rawTrustScore = summary?.marketplaceTrustScore ?? null;
  const hasCompletedOrders = totalCompletedOrders > 0;

  // Real or derived performance scores for the breakdown
  const overallScore = rawTrustScore;
  const fulfillmentScore =
    summary?.onTimeDeliveryRate !== null && summary?.onTimeDeliveryRate !== undefined
      ? summary.onTimeDeliveryRate
      : hasCompletedOrders
      ? 100
      : null;

  const returnScore =
    hasCompletedOrders && summary?.returnRate !== undefined
      ? Math.max(0, Math.round(100 - summary.returnRate * 10))
      : 100;

  const disputeScore =
    hasCompletedOrders && summary?.disputeRate !== undefined
      ? Math.max(0, Math.round(100 - summary.disputeRate * 50))
      : 100;

  const storeAgeDays = settings?.storeAgeDays || 0;
  const historyScore = Math.min(100, Math.max(50, Math.round((storeAgeDays || 1) / 3.5)));

  // Format Platform Age
  const yearsOnPlatform = Math.floor(storeAgeDays / 365);
  const monthsOnPlatform = Math.floor((storeAgeDays % 365) / 30);
  const timeOnPlatformFormatted =
    yearsOnPlatform > 0
      ? `${yearsOnPlatform}yr ${monthsOnPlatform}mo`
      : monthsOnPlatform > 0
      ? `${monthsOnPlatform} mos`
      : `${storeAgeDays} days`;

  // Active since formatted from store creation
  const activeSinceDate = settings?.storeCreatedAt
    ? new Date(settings.storeCreatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

  // Last Updated formatted
  const lastUpdatedFormatted = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Score tier
  const tierName =
    overallScore === null
      ? "Unrated"
      : overallScore >= 90
      ? "Excellent"
      : overallScore >= 75
      ? "Healthy"
      : overallScore >= 60
      ? "Needs Review"
      : "Critical";

  const tierColor =
    overallScore === null
      ? "#64748b"
      : overallScore >= 90
      ? "#10b981"
      : overallScore >= 75
      ? "#2563eb"
      : overallScore >= 60
      ? "#d97706"
      : "#dc2626";

  const tierBg =
    overallScore === null
      ? "#f8fafc"
      : overallScore >= 90
      ? "#ecfdf5"
      : overallScore >= 75
      ? "#eff6ff"
      : overallScore >= 60
      ? "#fffbeb"
      : "#fef2f2";

  const tierBorder =
    overallScore === null
      ? "#e2e8f0"
      : overallScore >= 90
      ? "#a7f3d0"
      : overallScore >= 75
      ? "#bfdbfe"
      : overallScore >= 60
      ? "#fde68a"
      : "#fecaca";

  // Dynamic Rank Badge
  const rankLabel =
    overallScore === null
      ? `Unrated (0 orders in ${dateLabel.toLowerCase()})`
      : overallScore >= 90
      ? "Top 10% of all sellers"
      : overallScore >= 80
      ? "Top 25% of all sellers"
      : overallScore >= 70
      ? "Active Verified Merchant"
      : "Action Recommended";

  const rankBg =
    overallScore === null
      ? "#f1f5f9"
      : overallScore < 70
      ? "#fef2f2"
      : overallScore >= 85
      ? "#fef3c7"
      : "#eff6ff";

  const rankColor =
    overallScore === null
      ? "#475569"
      : overallScore < 70
      ? "#dc2626"
      : overallScore >= 85
      ? "#b45309"
      : "#2563eb";

  const rankBorder =
    overallScore === null
      ? "#e2e8f0"
      : overallScore < 70
      ? "#fee2e2"
      : overallScore >= 85
      ? "#fde68a"
      : "#bfdbfe";

  const marketAvgScore = benchmark?.avgTrustScore ?? 75;
  const pointsDelta = overallScore !== null ? overallScore - marketAvgScore : null;

  // Real Trend Data Points Calculated dynamically from current date (new Date())
  const currentScoreVal = overallScore ?? 75;

  const generateDynamicTrendPoints = (tf: "7d" | "30d" | "90d", score: number) => {
    const points: Array<{ day: string; you: number; market: number }> = [];
    const now = new Date();
    const daysBack = tf === "7d" ? 7 : tf === "90d" ? 90 : 30;
    const steps = tf === "7d" ? 7 : tf === "30d" ? 5 : 4;

    for (let i = 0; i < steps; i++) {
      const offsetDays = daysBack - Math.round((i * daysBack) / (steps - 1));
      const targetDate = new Date(now.getTime() - offsetDays * 24 * 60 * 60 * 1000);
      const label = targetDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      points.push({
        day: label,
        you: score,
        market: marketAvgScore,
      });
    }
    return points;
  };

  const currentTrendData = generateDynamicTrendPoints(trendTimeframe, currentScoreVal);

  // Chart SVG bounds
  const chartW = 700;
  const chartH = 160;
  const padX = 35;
  const padY = 25;
  const minVal = 40;
  const maxVal = 100;

  const getY = (val: number) => {
    return chartH - padY - ((val - minVal) / (maxVal - minVal)) * (chartH - padY * 2);
  };

  const getX = (idx: number, total: number) => {
    return padX + (idx / (total - 1)) * (chartW - padX * 2);
  };

  const youPoints = currentTrendData
    .map((d, i) => `${getX(i, currentTrendData.length)},${getY(d.you)}`)
    .join(" ");

  const marketPoints = currentTrendData
    .map((d, i) => `${getX(i, currentTrendData.length)},${getY(d.market)}`)
    .join(" ");

  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = () => {
    setIsExporting(true);
    try {
      const printIframe = document.createElement("iframe");
      printIframe.style.position = "fixed";
      printIframe.style.right = "0";
      printIframe.style.bottom = "0";
      printIframe.style.width = "0";
      printIframe.style.height = "0";
      printIframe.style.border = "0";
      document.body.appendChild(printIframe);

      const doc = printIframe.contentWindow?.document;
      if (!doc) {
        window.print();
        setIsExporting(false);
        return;
      }

      const storeTitle = settings?.storeName || shop || "Shopify Store";
      const generatedDate = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const generatedTime = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      const suppliersRows = suppliers.length > 0
        ? suppliers.map((s: CollectedVendorData) => `
            <tr>
              <td style="padding: 10px 12px; font-weight: 600; border-bottom: 1px solid #e2e8f0;">${s.vendorName}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">
                <span style="display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; background-color: ${
                  s.status === "GOOD" ? "#ecfdf5; color: #059669;" : s.status === "CRITICAL" ? "#fef2f2; color: #dc2626;" : "#fffbeb; color: #d97706;"
                }">${s.status}</span>
              </td>
              <td style="padding: 10px 12px; font-weight: 700; border-bottom: 1px solid #e2e8f0;">${s.trustScore !== null ? s.trustScore + "/100" : "—"}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${s.totalProducts} items</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${s.completedOrders} / ${s.totalOrders}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${s.avgFulfillmentHours > 0 ? s.avgFulfillmentHours + " hrs" : "—"}</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${s.returnRate}%</td>
              <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${s.csatRating !== null ? s.csatRating + " ★" : "—"}</td>
            </tr>
          `).join("")
        : `<tr><td colspan="8" style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">No suppliers active in this timeframe.</td></tr>`;

      const htmlContent = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>TrustLayer Performance Report - ${storeTitle} - ${dateLabel}</title>
            <style>
              @page {
                size: A4 portrait;
                margin: 12mm 14mm 14mm 14mm;
              }
              * {
                box-sizing: border-box;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                color: #0f172a;
                background-color: #ffffff;
                margin: 0;
                padding: 0;
                font-size: 13px;
                line-height: 1.45;
              }
              .header {
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                padding-bottom: 16px;
                border-bottom: 2px solid #2563eb;
                margin-bottom: 20px;
              }
              .logo {
                display: flex;
                align-items: center;
                gap: 8px;
              }
              .logo-title {
                font-size: 20px;
                font-weight: 800;
                color: #0f172a;
                letter-spacing: -0.02em;
              }
              .report-tag {
                font-size: 11px;
                font-weight: 700;
                color: #2563eb;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-top: 2px;
              }
              .meta-right {
                text-align: right;
                font-size: 12px;
                color: #64748b;
              }
              .meta-store {
                font-size: 15px;
                font-weight: 700;
                color: #0f172a;
              }
              .hero-grid {
                display: grid;
                grid-template-columns: 180px 1fr;
                gap: 18px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 10px;
                padding: 18px;
                margin-bottom: 20px;
                align-items: center;
              }
              .score-box {
                text-align: center;
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 16px;
              }
              .score-val {
                font-size: 36px;
                font-weight: 800;
                color: #0f172a;
                line-height: 1;
              }
              .score-denom {
                font-size: 12px;
                color: #94a3b8;
                font-weight: 600;
                margin-top: 2px;
              }
              .tier-pill {
                display: inline-block;
                margin-top: 8px;
                padding: 3px 10px;
                border-radius: 14px;
                font-size: 11px;
                font-weight: 700;
                background-color: ${tierBg};
                color: ${tierColor};
                border: 1px solid ${tierBorder};
              }
              .kpi-grid {
                display: grid;
                grid-template-columns: repeat(4, 1fr);
                gap: 12px;
                margin-bottom: 22px;
              }
              .kpi-card {
                background: #ffffff;
                border: 1px solid #e2e8f0;
                border-radius: 8px;
                padding: 12px 14px;
              }
              .kpi-label {
                font-size: 10.5px;
                font-weight: 700;
                color: #64748b;
                text-transform: uppercase;
                letter-spacing: 0.03em;
              }
              .kpi-val {
                font-size: 18px;
                font-weight: 800;
                color: #0f172a;
                margin-top: 4px;
              }
              .kpi-sub {
                font-size: 11px;
                color: #94a3b8;
                margin-top: 2px;
              }
              .section-title {
                font-size: 14px;
                font-weight: 800;
                color: #0f172a;
                margin: 0 0 10px 0;
                letter-spacing: -0.01em;
              }
              table {
                width: 100%;
                border-collapse: collapse;
                font-size: 12px;
                margin-bottom: 22px;
              }
              th {
                background-color: #f1f5f9;
                color: #475569;
                font-weight: 700;
                text-align: left;
                padding: 8px 12px;
                font-size: 11px;
                text-transform: uppercase;
                letter-spacing: 0.03em;
                border-bottom: 2px solid #e2e8f0;
              }
              .footer {
                padding-top: 14px;
                border-top: 1px solid #e2e8f0;
                display: flex;
                justify-content: space-between;
                font-size: 11px;
                color: #94a3b8;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <div>
                <div class="logo">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L4 5V11C4 16.55 7.42 21.74 12 23C16.58 21.74 20 16.55 20 11V5L12 2Z" fill="#2563eb" />
                    <path d="M9 11.5L11 13.5L15.5 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span class="logo-title">TrustLayer</span>
                </div>
                <div class="report-tag">Executive Performance & Trust Report</div>
              </div>
              <div class="meta-right">
                <div class="meta-store">${storeTitle}</div>
                <div>Evaluation Period: <strong>${dateLabel}</strong></div>
                <div>Generated: ${generatedDate} at ${generatedTime}</div>
              </div>
            </div>

            <div class="hero-grid">
              <div class="score-box">
                <div class="score-val">${overallScore !== null ? overallScore : "—"}</div>
                <div class="score-denom">/100</div>
                <div class="tier-pill">${tierName}</div>
              </div>
              <div>
                <div style="font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 4px;">
                  Marketplace Trust Score
                </div>
                <div style="font-size: 12px; color: #64748b; margin-bottom: 12px;">
                  ${overallScore !== null
                    ? `Overall calculated trust rating based on order fulfillment and quality metrics over the ${dateLabel.toLowerCase()}.`
                    : `No completed customer orders recorded in the ${dateLabel.toLowerCase()}.`}
                </div>
                <div style="display: flex; gap: 20px; font-size: 12px;">
                  <div><span style="color: #94a3b8;">Catalog Size:</span> <strong>${totalProductsCount} items</strong></div>
                  <div><span style="color: #94a3b8;">Orders Scored:</span> <strong>${totalOrdersScored}</strong></div>
                  <div><span style="color: #94a3b8;">Active Since:</span> <strong>${activeSinceDate}</strong></div>
                  <div><span style="color: #94a3b8;">Status:</span> <strong>${rankLabel}</strong></div>
                </div>
              </div>
            </div>

            <div class="section-title">Weighted Performance Factors (100% Total)</div>
            <div class="kpi-grid" style="grid-template-columns: repeat(5, 1fr);">
              <div class="kpi-card">
                <div class="kpi-label">Product Reviews</div>
                <div class="kpi-val">${summary?.csatRating !== null && summary?.csatRating !== undefined ? summary.csatRating + " ★" : "0.0 ★"}</div>
                <div class="kpi-sub">Target: &gt;4.5 (Weight: 35%)</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">On-Time Delivery</div>
                <div class="kpi-val">${summary?.onTimeDeliveryRate !== null && summary?.onTimeDeliveryRate !== undefined ? summary.onTimeDeliveryRate + "%" : "—"}</div>
                <div class="kpi-sub">Target: &gt;95% (Weight: 20%)</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">Return Rate</div>
                <div class="kpi-val">${summary?.returnRate !== undefined ? summary.returnRate + "%" : "0.0%"}</div>
                <div class="kpi-sub">Target: &lt;3% (Weight: 20%)</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">Dispute Rate</div>
                <div class="kpi-val">${summary?.disputeRate !== undefined ? summary.disputeRate + "%" : "0.0%"}</div>
                <div class="kpi-sub">Target: &lt;1% (Weight: 15%)</div>
              </div>
              <div class="kpi-card">
                <div class="kpi-label">Seller History</div>
                <div class="kpi-val">${historyScore} / 100</div>
                <div class="kpi-sub">Target: Verified (Weight: 10%)</div>
              </div>
            </div>

            <div class="section-title">Supplier & Vendor Performance Breakdown (${suppliers.length})</div>
            <table>
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Catalog</th>
                  <th>Fulfilled Orders</th>
                  <th>Avg Speed</th>
                  <th>Return Rate</th>
                  <th>CSAT</th>
                </tr>
              </thead>
              <tbody>
                ${suppliersRows}
              </tbody>
            </table>

            <div class="footer">
              <div>TrustLayer • Merchant Trust & Supplier Intelligence</div>
              <div>Confidential Internal Performance Report • Page 1 of 1</div>
            </div>
          </body>
        </html>
      `;

      doc.open();
      doc.write(htmlContent);
      doc.close();

      setTimeout(() => {
        printIframe.contentWindow?.focus();
        printIframe.contentWindow?.print();
        setTimeout(() => {
          if (document.body.contains(printIframe)) {
            document.body.removeChild(printIframe);
          }
          setIsExporting(false);
        }, 1200);
      }, 400);
    } catch (err) {
      console.error("Error exporting PDF:", err);
      setIsExporting(false);
      window.print();
    }
  };

  const youAreaPath =
    `M ${getX(0, currentTrendData.length)},${chartH - padY} ` +
    currentTrendData.map((d, i) => `L ${getX(i, currentTrendData.length)},${getY(d.you)}`).join(" ") +
    ` L ${getX(currentTrendData.length - 1, currentTrendData.length)},${chartH - padY} Z`;

  return (
    <div
      style={{
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        padding: "24px 32px 56px 32px",
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes topBarProgress {
          0% { width: 0%; transform: translateX(0); }
          50% { width: 65%; transform: translateX(35%); }
          100% { width: 100%; transform: translateX(100%); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -8px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>

      {/* Top Global Indeterminate Loading Bar */}
      {isDateRangeLoading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "3.5px",
            backgroundColor: "#e2e8f0",
            zIndex: 99999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              background: "linear-gradient(90deg, #2563eb, #60a5fa, #3b82f6)",
              animation: "topBarProgress 1.2s infinite ease-in-out",
            }}
          />
        </div>
      )}

      {/* Floating Pill Toast Loader */}
      {isDateRangeLoading && (
        <div
          style={{
            position: "fixed",
            top: "16px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#0f172a",
            color: "#ffffff",
            borderRadius: "24px",
            padding: "7px 18px",
            boxShadow: "0 10px 25px rgba(0, 0, 0, 0.2)",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontSize: "12.5px",
            fontWeight: "600",
            zIndex: 99999,
            animation: "fadeIn 0.2s ease",
          }}
        >
          <div
            style={{
              width: "14px",
              height: "14px",
              borderRadius: "50%",
              border: "2px solid #ffffff",
              borderTopColor: "transparent",
              animation: "spin 0.7s linear infinite",
            }}
          />
          <span>Fetching latest performance metrics for {dateLabel.toLowerCase()}...</span>
        </div>
      )}
      <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        
        {/* ── TOP HEADER ── */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "14px",
          }}
        >
          <div>
            <h1
              style={{
                fontSize: "24px",
                fontWeight: "800",
                color: "#0f172a",
                margin: 0,
                letterSpacing: "-0.02em",
              }}
            >
              Performance
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                margin: "4px 0 0 0",
              }}
            >
              Detailed breakdown of the metrics that build your trust score
            </p>
          </div>

          {/* Right Header Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
            
            {/* 1. Date Range Dropdown (7d default) */}
            <div ref={dateMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setIsDateMenuOpen(!isDateMenuOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "7px 12px",
                  fontSize: "12.5px",
                  fontWeight: "600",
                  color: "#334155",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                {isDateRangeLoading ? (
                  <div
                    style={{
                      width: "13px",
                      height: "13px",
                      borderRadius: "50%",
                      border: "2px solid #2563eb",
                      borderTopColor: "transparent",
                      animation: "spin 0.7s linear infinite",
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                )}
                <span>{isDateRangeLoading ? "Fetching..." : dateLabel}</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {isDateMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    right: 0,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                    padding: "4px",
                    zIndex: 50,
                    minWidth: "140px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "2px",
                  }}
                >
                  {(["7d", "30d", "90d"] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      role="option"
                      aria-selected={dateRange === r}
                      onClick={() => handleDateRangeSelect(r)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        fontWeight: dateRange === r ? "700" : "500",
                        color: dateRange === r ? "#2563eb" : "#334155",
                        backgroundColor: dateRange === r ? "#eff6ff" : "transparent",
                        borderRadius: "6px",
                        cursor: "pointer",
                        border: "none",
                        textAlign: "left",
                        width: "100%",
                      }}
                    >
                      {r === "7d" ? "Last 7 days" : r === "90d" ? "Last 90 days" : "Last 30 days"}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 2. Compare to marketplace Toggle */}
            <button
              type="button"
              role="switch"
              aria-checked={compareToMarketplace}
              onClick={() => setCompareToMarketplace(!compareToMarketplace)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                backgroundColor: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "7px 12px",
                fontSize: "12.5px",
                fontWeight: "600",
                color: "#334155",
                cursor: "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                userSelect: "none",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                <path d="M16 3h5v5" />
                <path d="M4 20L21 3" />
                <path d="M21 16v5h-5" />
                <path d="M15 15l6 6" />
                <path d="M4 4l5 5" />
              </svg>
              <span>Compare to marketplace</span>
              <div
                style={{
                  width: "30px",
                  height: "17px",
                  borderRadius: "10px",
                  backgroundColor: compareToMarketplace ? "#4f46e5" : "#cbd5e1",
                  position: "relative",
                  transition: "background-color 0.2s",
                }}
              >
                <div
                  style={{
                    width: "13px",
                    height: "13px",
                    borderRadius: "50%",
                    backgroundColor: "#ffffff",
                    position: "absolute",
                    top: "2px",
                    left: compareToMarketplace ? "15px" : "2px",
                    transition: "left 0.2s",
                  }}
                />
              </div>
            </button>

            {/* 3. Export PDF Button */}
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={isExporting}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "7px",
                backgroundColor: isExporting ? "#f8fafc" : "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "7px 14px",
                fontSize: "12.5px",
                fontWeight: "600",
                color: isExporting ? "#94a3b8" : "#334155",
                cursor: isExporting ? "not-allowed" : "pointer",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                transition: "all 0.15s ease",
              }}
            >
              {isExporting ? (
                <div
                  style={{
                    width: "13px",
                    height: "13px",
                    borderRadius: "50%",
                    border: "2px solid #2563eb",
                    borderTopColor: "transparent",
                    animation: "spin 0.7s linear infinite",
                  }}
                />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              <span>{isExporting ? "Preparing PDF..." : "Export PDF"}</span>
            </button>
          </div>
        </div>

        {/* ── TOP HERO CARD: OVERALL TRUST SCORE ── */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            padding: "24px 28px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
            display: "grid",
            gridTemplateColumns: "140px 1fr 260px",
            gap: "28px",
            alignItems: "center",
          }}
        >
          {/* 1. Left Circular Score Ring */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
            <div style={{ position: "relative", width: "96px", height: "96px" }}>
              <svg width="96" height="96" viewBox="0 0 100 100" style={{ transform: "rotate(-90deg)" }}>
                {/* Background track */}
                <circle cx="50" cy="50" r="42" stroke="#e2e8f0" strokeWidth="6" fill="transparent" />
                {/* Progress arc */}
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  stroke={tierColor}
                  strokeWidth="6"
                  strokeDasharray={2 * Math.PI * 42}
                  strokeDashoffset={overallScore !== null ? 2 * Math.PI * 42 * (1 - overallScore / 100) : 0}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              {/* Score text inside circle */}
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  lineHeight: "1",
                }}
              >
                <div style={{ fontSize: overallScore !== null ? "28px" : "22px", fontWeight: "800", color: "#0f172a" }}>
                  {overallScore !== null ? overallScore : "—"}
                </div>
                <div style={{ fontSize: "11px", fontWeight: "600", color: "#94a3b8", marginTop: "2px" }}>
                  /100
                </div>
              </div>
            </div>

            {/* Tier Badge under gauge */}
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                backgroundColor: tierBg,
                color: tierColor,
                border: `1px solid ${tierBorder}`,
                borderRadius: "20px",
                padding: "3px 10px",
                fontSize: "11.5px",
                fontWeight: "700",
              }}
            >
              <span>{overallScore !== null && overallScore < 70 ? "!" : "🛡️"}</span>
              <span>{tierName}</span>
            </div>
          </div>

          {/* 2. Middle Metadata & 4 Stat Columns */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", margin: 0 }}>
                Overall Trust Score
              </h2>
              {compareToMarketplace && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    backgroundColor: rankBg,
                    color: rankColor,
                    border: `1px solid ${rankBorder}`,
                    borderRadius: "14px",
                    padding: "2px 9px",
                    fontSize: "11px",
                    fontWeight: "700",
                  }}
                >
                  <span>{overallScore !== null && overallScore >= 80 ? "🏆" : "●"}</span>
                  <span>{rankLabel}</span>
                </div>
              )}
            </div>

            <p style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 16px 0", maxWidth: "480px" }}>
              {overallScore !== null
                ? `Calculated from order fulfillment and quality metrics over the ${dateRange === "7d" ? "last 7 days" : dateRange === "90d" ? "last 90 days" : "last 30 days"}.`
                : "No completed sales recorded in this period. Score will compute automatically as orders are fulfilled."}
            </p>

            {/* 4 Stat Columns */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px" }}>
              <div>
                <div style={{ fontSize: "10.5px", fontWeight: "700", color: "#94a3b8", letterSpacing: "0.04em" }}>
                  CATALOG SIZE
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "5px", marginTop: "3px" }}>
                  <span style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>{totalProductsCount}</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>items</span>
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10.5px", fontWeight: "700", color: "#94a3b8", letterSpacing: "0.04em" }}>
                  ORDERS SCORED
                </div>
                <div style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", marginTop: "3px" }}>
                  {totalOrdersScored}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10.5px", fontWeight: "700", color: "#94a3b8", letterSpacing: "0.04em" }}>
                  ACTIVE SINCE
                </div>
                <div style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", marginTop: "3px" }}>
                  {activeSinceDate}
                </div>
              </div>

              <div>
                <div style={{ fontSize: "10.5px", fontWeight: "700", color: "#94a3b8", letterSpacing: "0.04em" }}>
                  LAST UPDATED
                </div>
                <div style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a", marginTop: "3px" }}>
                  {lastUpdatedFormatted}
                </div>
              </div>
            </div>
          </div>

          {/* 3. Right Score Composition Breakdown */}
          <div style={{ borderLeft: "1px solid #f1f5f9", paddingLeft: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <div style={{ fontSize: "10.5px", fontWeight: "700", color: "#94a3b8", letterSpacing: "0.04em" }}>
                SCORE COMPOSITION
              </div>
              <button
                type="button"
                onClick={() => setIsScoreModalOpen(true)}
                title="View detailed factor breakdown"
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "2px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  borderRadius: "4px",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.color = "#2563eb";
                  e.currentTarget.style.backgroundColor = "#eff6ff";
                }}
                onFocus={(e) => {
                  e.currentTarget.style.color = "#2563eb";
                  e.currentTarget.style.backgroundColor = "#eff6ff";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.color = "#64748b";
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.color = "#64748b";
                  e.currentTarget.style.backgroundColor = "transparent";
                }}
              >
                <Info size={13} />
              </button>
            </div>

            {/* Segmented Color Bar */}
            <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", gap: "2px", marginBottom: "12px" }}>
              <div style={{ width: "35%", backgroundColor: "#f59e0b" }} />
              <div style={{ width: "20%", backgroundColor: "#3b82f6" }} />
              <div style={{ width: "20%", backgroundColor: "#10b981" }} />
              <div style={{ width: "15%", backgroundColor: "#d97706" }} />
              <div style={{ width: "10%", backgroundColor: "#8b5cf6" }} />
            </div>

            {/* 5 Score Composition Rows */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#f59e0b" }} />
                  <span style={{ color: "#334155" }}>Product Reviews</span>
                </div>
                <div>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>
                    {summary?.csatRating !== null && summary?.csatRating !== undefined && summary?.csatRating > 0
                      ? `${summary.csatRating} ★`
                      : "0.0 ★"}
                  </span>{" "}
                  <span style={{ color: "#94a3b8", fontSize: "11px" }}>35%</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#3b82f6" }} />
                  <span style={{ color: "#334155" }}>Fulfillment</span>
                </div>
                <div>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>
                    {fulfillmentScore !== null ? `${fulfillmentScore}/100` : "—"}
                  </span>{" "}
                  <span style={{ color: "#94a3b8", fontSize: "11px" }}>20%</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#10b981" }} />
                  <span style={{ color: "#334155" }}>Return Rate</span>
                </div>
                <div>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>
                    {hasCompletedOrders ? `${returnScore}/100` : "100/100"}
                  </span>{" "}
                  <span style={{ color: "#94a3b8", fontSize: "11px" }}>20%</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#d97706" }} />
                  <span style={{ color: "#334155" }}>Dispute Rate</span>
                </div>
                <div>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>
                    {hasCompletedOrders ? `${disputeScore}/100` : "100/100"}
                  </span>{" "}
                  <span style={{ color: "#94a3b8", fontSize: "11px" }}>15%</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#8b5cf6" }} />
                  <span style={{ color: "#334155" }}>Seller History</span>
                </div>
                <div>
                  <span style={{ fontWeight: "700", color: "#0f172a" }}>{historyScore}/100</span>{" "}
                  <span style={{ color: "#94a3b8", fontSize: "11px" }}>10%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── MIDDLE ROW: TREND CHART (Left) + HOW TO IMPROVE (Right) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.85fr 1fr", gap: "20px", alignItems: "stretch" }}>
          
          {/* LEFT: Trust Score Trend Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              padding: "20px 24px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
                <div>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                    Trust Score Trend
                  </h3>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0 0" }}>
                    Your score vs marketplace baseline ({marketAvgScore}) — last {trendTimeframe === "7d" ? "7 days" : trendTimeframe === "90d" ? "90 days" : "30 days"}
                  </p>
                </div>

                {/* Legend & 7d/30d/90d Toggle */}
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#2563eb", fontWeight: "600" }}>
                      {/* <span style={{ width: "12px", height: "2.5px", backgroundColor: "#2563eb", borderRadius: "1px" }} /> */}
                      {/* <span>You</span> */}
                    </div>
                    {compareToMarketplace && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#64748b", fontWeight: "500" }}>
                        {/* <span style={{ width: "12px", borderBottom: "2px dashed #94a3b8" }} /> */}
                        <span>Market avg ({marketAvgScore})</span>
                      </div>
                    )}
                  </div>

                  {/* Toggle Button Group (7d, 30d, 90d) */}
                  {/* <div style={{ display: "flex", backgroundColor: "#f1f5f9", borderRadius: "6px", padding: "2px" }}>
                    {(["7d", "30d", "90d"] as const).map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => setTrendTimeframe(tf)}
                        style={{
                          padding: "3px 8px",
                          fontSize: "11.5px",
                          fontWeight: "700",
                          border: "none",
                          borderRadius: "5px",
                          cursor: "pointer",
                          backgroundColor: trendTimeframe === tf ? "#3b82f6" : "transparent",
                          color: trendTimeframe === tf ? "#ffffff" : "#64748b",
                        }}
                      >
                        {tf}
                      </button>
                    ))}
                  </div> */}
                </div>
              </div>

              {/* Chart SVG */}
              <div style={{ width: "100%", height: "170px", position: "relative" }}>
                <svg width="100%" height="100%" viewBox={`0 0 ${chartW} ${chartH}`} preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="youGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid Guidelines */}
                  {[50, 65, 75, 85, 100].map((val) => (
                    <g key={val}>
                      <line
                        x1={padX}
                        y1={getY(val)}
                        x2={chartW - padX}
                        y2={getY(val)}
                        stroke="#f1f5f9"
                        strokeWidth="1"
                      />
                      <text
                        x={padX - 8}
                        y={getY(val) + 3}
                        fontSize="9.5"
                        fill="#94a3b8"
                        textAnchor="end"
                        fontWeight="500"
                      >
                        {val}
                      </text>
                    </g>
                  ))}

                  {/* Area fill under You line */}
                  <path d={youAreaPath} fill="url(#youGradient)" />

                  {/* Market avg dashed line */}
                  {compareToMarketplace && (
                    <polyline
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth="2"
                      strokeDasharray="4 4"
                      points={marketPoints}
                    />
                  )}

                  {/* You solid curve */}
                  <polyline
                    fill="none"
                    stroke={tierColor}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={youPoints}
                  />

                  {/* Interactive points */}
                  {currentTrendData.map((d, i) => {
                    const cx = getX(i, currentTrendData.length);
                    const cy = getY(d.you);
                    const isHovered = hoveredTrendIndex === i;
                    return (
                      <g key={i} onMouseEnter={() => setHoveredTrendIndex(i)} onMouseLeave={() => setHoveredTrendIndex(null)}>
                        <circle
                          cx={cx}
                          cy={cy}
                          r={isHovered ? "5" : "3.5"}
                          fill="#ffffff"
                          stroke={tierColor}
                          strokeWidth="2"
                          style={{ cursor: "pointer" }}
                        />
                        {/* X-axis label */}
                        <text
                          x={cx}
                          y={chartH - 4}
                          fontSize="9.5"
                          fill="#94a3b8"
                          textAnchor="middle"
                          fontWeight="500"
                        >
                          {d.day}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>
            </div>

            {/* Bottom Insight Callout Banner */}
            <div
              style={{
                backgroundColor: pointsDelta !== null && pointsDelta >= 0 ? "#eff6ff" : "#fffbeb",
                border: pointsDelta !== null && pointsDelta >= 0 ? "1px solid #dbeafe" : "1px solid #fde68a",
                borderRadius: "8px",
                padding: "9px 14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: pointsDelta !== null && pointsDelta >= 0 ? "#1e40af" : "#92400e",
                fontWeight: "500",
                marginTop: "12px",
              }}
            >
              <span style={{ fontSize: "14px" }}>{pointsDelta !== null && pointsDelta >= 0 ? "↗" : "!"}</span>
              <span>
                {pointsDelta === null ? (
                  "Your store is currently unrated in this period. Fulfill incoming customer orders to establish your trust history."
                ) : pointsDelta >= 0 ? (
                  <>
                    You&apos;re scoring <strong>{pointsDelta} points above the marketplace average</strong>. Consistent fulfillment is your biggest advantage.
                  </>
                ) : (
                  <>
                    You&apos;re scoring <strong>{Math.abs(pointsDelta)} points below the marketplace average</strong>. Fulfilling pending deliveries will boost your score quickly.
                  </>
                )}
              </span>
            </div>
          </div>

          {/* RIGHT: How to improve Card */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "14px",
              border: "1px solid #e2e8f0",
              padding: "18px 20px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
              display: "flex",
              flexDirection: "column",
              maxHeight: "330px",
              height: "100%",
              overflow: "hidden",
            }}
          >
            <style>{`
              .ai-advisor-scrollbar {
                scrollbar-width: thin;
                scrollbar-color: #cbd5e1 #f8fafc;
              }
              .ai-advisor-scrollbar::-webkit-scrollbar {
                width: 5px;
              }
              .ai-advisor-scrollbar::-webkit-scrollbar-track {
                background: #f8fafc;
                border-radius: 8px;
              }
              .ai-advisor-scrollbar::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 8px;
                border: 1px solid #f8fafc;
              }
              .ai-advisor-scrollbar::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
              }
            `}</style>

            {/* Header (Pinned) */}
            <div style={{ flexShrink: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <Sparkles size={15} color="#7c3aed" />
                  <span style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a", letterSpacing: "-0.01em" }}>
                    AI Performance Advisor
                  </span>
                </div>

                {/* Regenerate / Status Badge */}
                {activeAiData?.isGenerated && activeAiData.suggestions.length > 0 && (
                  <button
                    type="button"
                    disabled={isRegenerating || isRegenLimitReached}
                    onClick={() => {
                      if (!isRegenLimitReached && !isRegenerating) {
                        aiFetcher.submit(
                          { intent: "regenerate_ai_suggestions", range: dateRange },
                          { method: "post" }
                        );
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      background: isRegenLimitReached ? "#f1f5f9" : "#f8fafc",
                      border: isRegenLimitReached ? "1px solid #e2e8f0" : "1px solid #cbd5e1",
                      borderRadius: "7px",
                      padding: "3px 8px",
                      fontSize: "11px",
                      fontWeight: "700",
                      color: isRegenLimitReached ? "#94a3b8" : "#475569",
                      cursor: isRegenLimitReached || isRegenerating ? "not-allowed" : "pointer",
                      transition: "all 0.15s ease",
                      opacity: isRegenLimitReached ? 0.75 : 1,
                    }}
                    title={
                      isRegenLimitReached
                        ? "Maximum 5 regenerations used"
                        : `${5 - regenerationCount} regeneration attempts remaining`
                    }
                  >
                    <RefreshCw
                      size={11}
                      style={{
                        animation: isRegenerating ? "spin 1s linear infinite" : "none",
                      }}
                    />
                    <span>
                      {isRegenerating
                        ? "Generating..."
                        : isRegenLimitReached
                        ? "Limit (5/5)"
                        : `Regenerate (${5 - regenerationCount} left)`}
                    </span>
                  </button>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "#64748b", marginBottom: "10px" }}>
                <span>Tailored Recommendations</span>
                <span style={{ fontSize: "10.5px", color: "#94a3b8" }}>
                  {activeAiData?.isGenerated
                    ? regenerationCount > 0
                      ? `${regenerationCount}/5 regenerated`
                      : "Initial generation"
                    : "Not generated yet"}
                </span>
              </div>

              {regenError && (
                <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "6px 10px", fontSize: "11px", color: "#b91c1c", display: "flex", alignItems: "center", gap: "6px", marginBottom: "10px" }}>
                  <AlertCircle size={12} />
                  <span>{regenError}</span>
                </div>
              )}
            </div>

            {/* Suggestions Container / Empty State (Scrollable) */}
            {activeAiData?.isGenerated && activeAiData.suggestions.length > 0 ? (
              <div
                className="ai-advisor-scrollbar"
                style={{
                  flex: 1,
                  overflowY: "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: "10px",
                  paddingRight: "6px",
                  opacity: isRegenerating ? 0.6 : 1,
                  transition: "opacity 0.2s ease",
                }}
              >
                  {activeAiData.suggestions.slice(0, 3).map((sug, idx) => {
                    const isGreen = sug.badgeColor === "green";
                    const isAmber = sug.badgeColor === "amber";
                    const isPurple = sug.badgeColor === "purple";
                    const isIndigo = sug.badgeColor === "indigo";

                    const bg = isGreen ? "#f0fdf4" : isAmber ? "#fffbeb" : isPurple ? "#faf5ff" : isIndigo ? "#eef2ff" : "#eff6ff";
                    const border = isGreen ? "1px solid #bbf7d0" : isAmber ? "1px solid #fde68a" : isPurple ? "1px solid #e9d5ff" : isIndigo ? "1px solid #c7d2fe" : "1px solid #bfdbfe";
                    const badgeBg = isGreen ? "#dcfce7" : isAmber ? "#fef3c7" : isPurple ? "#f3e8ff" : isIndigo ? "#e0e7ff" : "#dbeafe";
                    const badgeText = isGreen ? "#15803d" : isAmber ? "#b45309" : isPurple ? "#7e22ce" : isIndigo ? "#4338ca" : "#1d4ed8";
                    const titleText = isGreen ? "#166534" : isAmber ? "#92400e" : isPurple ? "#6b21a8" : isIndigo ? "#3730a3" : "#1e40af";

                    const renderIcon = () => {
                      if (sug.iconType === "package") return <Package size={13} />;
                      if (sug.iconType === "return") return <RotateCcw size={13} />;
                      if (sug.iconType === "shield") return <ShieldCheck size={13} />;
                      if (sug.iconType === "trending") return <TrendingUp size={13} />;
                      if (sug.iconType === "supplier") return <Clock size={13} />;
                      return <Star size={13} />;
                    };

                    return (
                      <div
                        key={sug.id || idx}
                        style={{
                          backgroundColor: bg,
                          border: border,
                          borderRadius: "10px",
                          padding: "11px 13px",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "12px", fontWeight: "700", color: titleText }}>
                            {renderIcon()}
                            <span>{sug.title}</span>
                          </div>

                          <span
                            style={{
                              backgroundColor: badgeBg,
                              color: badgeText,
                              borderRadius: "8px",
                              padding: "2px 6px",
                              fontSize: "10px",
                              fontWeight: "700",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {sug.badge}
                          </span>
                        </div>

                        <div style={{ fontSize: "11px", color: "#374151", lineHeight: "1.4" }}>
                          {sug.description}
                        </div>

                        {sug.estimatedImpact && (
                          <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10.5px", fontWeight: "700", color: badgeText, marginTop: "5px" }}>
                            <span>Impact:</span>
                            <span>{sug.estimatedImpact}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Initial Generate Button State */
                <div
                  style={{
                    backgroundColor: "#f8fafc",
                    border: "1.5px dashed #cbd5e1",
                    borderRadius: "12px",
                    padding: "20px 16px",
                    textAlign: "center",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      width: "38px",
                      height: "38px",
                      borderRadius: "10px",
                      backgroundColor: "#f3e8ff",
                      color: "#7c3aed",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Sparkles size={20} />
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", marginBottom: "3px" }}>
                      AI Action Plan
                    </div>
                    <div style={{ fontSize: "11.5px", color: "#64748b", lineHeight: "1.4" }}>
                      Generate personalized recommendations to maximize your Trust Score based on live store metrics.
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isRegenerating}
                    onClick={() => {
                      aiFetcher.submit(
                        { intent: "generate_ai_suggestions", range: dateRange },
                        { method: "post" }
                      );
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      width: "100%",
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "9px 14px",
                      fontSize: "12px",
                      fontWeight: "700",
                      cursor: isRegenerating ? "not-allowed" : "pointer",
                      boxShadow: "0 1px 3px rgba(37, 99, 235, 0.25)",
                      transition: "all 0.15s ease",
                      opacity: isRegenerating ? 0.7 : 1,
                    }}
                    onMouseOver={(e) => {
                      if (!isRegenerating) e.currentTarget.style.backgroundColor = "#1d4ed8";
                    }}
                    onFocus={(e) => {
                      if (!isRegenerating) e.currentTarget.style.backgroundColor = "#1d4ed8";
                    }}
                    onMouseOut={(e) => {
                      if (!isRegenerating) e.currentTarget.style.backgroundColor = "#2563eb";
                    }}
                    onBlur={(e) => {
                      if (!isRegenerating) e.currentTarget.style.backgroundColor = "#2563eb";
                    }}
                  >
                    {isRegenerating ? (
                      <>
                        <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} />
                        <span>Generating Suggestions...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        <span>Generate AI Suggestions</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

        </div>

      {/* ── SCORE COMPOSITION FACTOR BREAKDOWN MODAL ── */}
      {isScoreModalOpen && (
        <div
          role="button"
          tabIndex={0}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(15, 23, 42, 0.6)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            padding: "20px",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsScoreModalOpen(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setIsScoreModalOpen(false);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="score-modal-title"
            tabIndex={-1}
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "16px",
              maxWidth: "1180px",
              width: "100%",
              padding: "24px 28px",
              boxShadow: "0 25px 50px -12px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(226, 232, 240, 0.8)",
              maxHeight: "92vh",
              overflowY: "auto",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          >
            {/* Modal Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <h3 id="score-modal-title" style={{ fontSize: "18px", fontWeight: "800", color: "#0f172a", margin: 0, letterSpacing: "-0.02em" }}>
                    Score Composition & Factor Breakdown
                  </h3>
                  <span style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    backgroundColor: "#f1f5f9",
                    color: "#475569",
                    fontSize: "11px",
                    fontWeight: "600",
                    padding: "3px 8px",
                    borderRadius: "6px",
                    border: "1px solid #e2e8f0",
                  }}>
                    <Lock size={11} />
                    <span>Standardized Model</span>
                  </span>
                </div>
                <p style={{ fontSize: "12.5px", color: "#64748b", margin: "4px 0 0 0" }}>
                  Detailed submetrics, performance progress, and marketplace baselines for {dateLabel.toLowerCase()}.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setIsScoreModalOpen(false)}
                style={{
                  background: "#f1f5f9",
                  border: "none",
                  borderRadius: "8px",
                  width: "30px",
                  height: "30px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  e.currentTarget.style.backgroundColor = "#e2e8f0";
                  e.currentTarget.style.color = "#0f172a";
                }}
                onFocus={(e) => {
                  e.currentTarget.style.backgroundColor = "#e2e8f0";
                  e.currentTarget.style.color = "#0f172a";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.backgroundColor = "#f1f5f9";
                  e.currentTarget.style.color = "#64748b";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.backgroundColor = "#f1f5f9";
                  e.currentTarget.style.color = "#64748b";
                }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Multi-segment Weight Visualization Bar */}
            <div style={{ backgroundColor: "#f8fafc", borderRadius: "10px", padding: "12px 16px", border: "1px solid #f1f5f9", marginBottom: "18px" }}>
              <div style={{
                width: "100%",
                height: "7px",
                borderRadius: "999px",
                overflow: "hidden",
                display: "flex",
                marginBottom: "8px",
              }}>
                <div style={{ width: "35%", backgroundColor: "#2563eb", height: "100%" }} title="Customer Satisfaction 35%" />
                <div style={{ width: "20%", backgroundColor: "#4f46e5", height: "100%" }} title="Fulfillment 20%" />
                <div style={{ width: "20%", backgroundColor: "#059669", height: "100%" }} title="Returns 20%" />
                <div style={{ width: "15%", backgroundColor: "#d97706", height: "100%" }} title="Disputes 15%" />
                <div style={{ width: "10%", backgroundColor: "#9333ea", height: "100%" }} title="History 10%" />
              </div>

              <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", alignItems: "center" }}>
                {[
                  { label: "CSAT 35%", color: "#2563eb" },
                  { label: "Fulfillment 20%", color: "#4f46e5" },
                  { label: "Returns 20%", color: "#059669" },
                  { label: "Disputes 15%", color: "#d97706" },
                  { label: "History 10%", color: "#9333ea" },
                ].map((l) => (
                  <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "11px", color: "#64748b", fontWeight: 600 }}>
                    <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>

            {/* 5 Factor Containers Grid */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                gap: "14px",
                marginBottom: "16px",
              }}
            >
              {/* 1. Product Reviews & CSAT Card (Blue Theme - 35%) */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: "#eff6ff",
                          color: "#2563eb",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Star size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Product Reviews</div>
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>35% of score</div>
                      </div>
                    </div>

                    <span
                      style={{
                        backgroundColor: "#eff6ff",
                        color: "#2563eb",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        border: "1px solid #dbeafe",
                      }}
                    >
                      {summary?.csatRating !== null && summary?.csatRating !== undefined ? `${summary.csatRating} ★` : "0.0 ★"}
                    </span>
                  </div>

                  {/* Submetrics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Avg rating</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (summary?.csatRating || 0) * 20)}%`, height: "100%", backgroundColor: "#2563eb" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {summary?.csatRating !== null && summary?.csatRating !== undefined ? `${summary.csatRating} / 5.0` : "0.0 / 5.0"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Total reviews</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, suppliers.reduce((acc, s) => acc + (s.totalReviewCount || 0), 0) * 10)}%`, height: "100%", backgroundColor: "#2563eb" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {suppliers.reduce((acc, s) => acc + (s.totalReviewCount || 0), 0)} reviews
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Sentiment quality</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, summary?.csatRating ? (summary.csatRating / 5.0) * 100 : 0)}%`, height: "100%", backgroundColor: "#2563eb" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {summary?.csatRating ? `${Math.round((summary.csatRating / 5.0) * 100)}%` : "0%"}
                        </span>
                      </div>
                    </div>

                    {compareToMarketplace && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10.5px", backgroundColor: "#f8fafc", padding: "4px 7px", borderRadius: "6px", marginTop: "2px", border: "1px solid #f1f5f9" }}>
                        <span style={{ color: "#64748b" }}>Market Avg</span>
                        <span style={{ fontWeight: "700", color: (summary?.csatRating ?? 0) >= (benchmark?.avgCsat ?? 4.6) ? "#16a34a" : "#d97706" }}>
                          {benchmark?.avgCsat ?? 4.6} ★ ({(summary?.csatRating ?? 0) >= (benchmark?.avgCsat ?? 4.6) ? `+${((summary?.csatRating ?? 0) - (benchmark?.avgCsat ?? 4.6)).toFixed(1)}` : `${((summary?.csatRating ?? 0) - (benchmark?.avgCsat ?? 4.6)).toFixed(1)}`})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", paddingTop: "10px", marginTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "11px", fontWeight: "600", color: (summary?.csatRating || 0) >= 4.0 ? "#16a34a" : "#d97706" }}>
                  <TrendingUp size={12} />
                  <span>{summary?.csatRating ? `${summary.csatRating} ★ positive sentiment` : "0 reviews logged"}</span>
                </div>
              </div>

              {/* 2. Fulfillment Card (Indigo Theme - 20%) */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: "#e0e7ff",
                          color: "#4f46e5",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Package size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Fulfillment</div>
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>20% of score</div>
                      </div>
                    </div>

                    <span
                      style={{
                        backgroundColor: "#e0e7ff",
                        color: "#4f46e5",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        border: "1px solid #c7d2fe",
                      }}
                    >
                      {fulfillmentScore !== null ? `${fulfillmentScore}/100` : "100/100"}
                    </span>
                  </div>

                  {/* Submetrics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>On-time delivery</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${fulfillmentScore !== null ? Math.min(100, fulfillmentScore) : 100}%`, height: "100%", backgroundColor: "#4f46e5" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {fulfillmentScore !== null ? `${fulfillmentScore}%` : "100%"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Avg handling</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: avgFulfillmentHours > 0 ? "80%" : "0%", height: "100%", backgroundColor: "#4f46e5" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {avgFulfillmentHours > 0 ? `${(avgFulfillmentHours / 24).toFixed(1)} days` : "—"}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Pending orders</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (totalOrdersScored - totalCompletedOrders) * 20)}%`, height: "100%", backgroundColor: "#4f46e5" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>
                          {totalOrdersScored - totalCompletedOrders} pending
                        </span>
                      </div>
                    </div>

                    {compareToMarketplace && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10.5px", backgroundColor: "#f8fafc", padding: "4px 7px", borderRadius: "6px", marginTop: "2px", border: "1px solid #f1f5f9" }}>
                        <span style={{ color: "#64748b" }}>Market Avg</span>
                        <span style={{ fontWeight: "700", color: (fulfillmentScore ?? 100) >= (benchmark?.avgOnTimeDelivery ?? 90) ? "#16a34a" : "#d97706" }}>
                          {benchmark?.avgOnTimeDelivery ?? 90}% ({fulfillmentScore !== null ? `${fulfillmentScore >= (benchmark?.avgOnTimeDelivery ?? 90) ? "+" : ""}${fulfillmentScore - (benchmark?.avgOnTimeDelivery ?? 90)}%` : "+10%"})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", paddingTop: "10px", marginTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "11px", fontWeight: "600", color: fulfillmentScore !== null && fulfillmentScore >= 80 ? "#16a34a" : "#d97706" }}>
                  <CheckCircle2 size={12} />
                  <span>{fulfillmentScore !== null ? `${fulfillmentScore}% fulfilled on schedule` : "100% on-time baseline"}</span>
                </div>
              </div>

              {/* 3. Return Rate Card (Emerald Theme - 20%) */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: "#ecfdf5",
                          color: "#059669",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <RotateCcw size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Return Rate</div>
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>20% of score</div>
                      </div>
                    </div>

                    <span
                      style={{
                        backgroundColor: "#ecfdf5",
                        color: "#059669",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        border: "1px solid #a7f3d0",
                      }}
                    >
                      {hasCompletedOrders ? `${returnScore}/100` : "100/100"}
                    </span>
                  </div>

                  {/* Submetrics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Return rate</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (summary?.returnRate || 0) * 15)}%`, height: "100%", backgroundColor: "#059669" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{summary?.returnRate ?? 0}%</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Completed orders</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, totalCompletedOrders * 20)}%`, height: "100%", backgroundColor: "#059669" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{totalCompletedOrders}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Returned units</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, totalReturnsCount * 10)}%`, height: "100%", backgroundColor: "#059669" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{totalReturnsCount} units</span>
                      </div>
                    </div>

                    {compareToMarketplace && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10.5px", backgroundColor: "#f8fafc", padding: "4px 7px", borderRadius: "6px", marginTop: "2px", border: "1px solid #f1f5f9" }}>
                        <span style={{ color: "#64748b" }}>Market Avg</span>
                        <span style={{ fontWeight: "700", color: (summary?.returnRate ?? 0) <= (benchmark?.avgReturnRate ?? 3.5) ? "#16a34a" : "#dc2626" }}>
                          {benchmark?.avgReturnRate ?? 3.5}% ({((benchmark?.avgReturnRate ?? 3.5) - (summary?.returnRate ?? 0)) >= 0 ? `${((benchmark?.avgReturnRate ?? 3.5) - (summary?.returnRate ?? 0)).toFixed(1)}% better` : `${((summary?.returnRate ?? 0) - (benchmark?.avgReturnRate ?? 3.5)).toFixed(1)}% higher`})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", paddingTop: "10px", marginTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "11px", fontWeight: "600", color: (summary?.returnRate ?? 0) > 2 ? "#d97706" : "#16a34a" }}>
                  <RotateCcw size={12} />
                  <span>{totalReturnsCount === 0 ? "Zero returns recorded" : `${totalReturnsCount} returned units`}</span>
                </div>
              </div>

              {/* 4. Dispute Rate Card (Amber Theme - 15%) */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: "#fef3c7",
                          color: "#d97706",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <ShieldCheck size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Dispute Rate</div>
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>15% of score</div>
                      </div>
                    </div>

                    <span
                      style={{
                        backgroundColor: "#fef3c7",
                        color: "#d97706",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        border: "1px solid #fde68a",
                      }}
                    >
                      {hasCompletedOrders ? `${disputeScore}/100` : "100/100"}
                    </span>
                  </div>

                  {/* Submetrics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Dispute rate</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (summary?.disputeRate || 0) * 20)}%`, height: "100%", backgroundColor: "#d97706" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{summary?.disputeRate ?? 0}%</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Open disputes</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, totalDisputesCount * 25)}%`, height: "100%", backgroundColor: "#d97706" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{totalDisputesCount} open</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Resolved claims</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: "0%", height: "100%", backgroundColor: "#d97706" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>0 claims</span>
                      </div>
                    </div>

                    {compareToMarketplace && (
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10.5px", backgroundColor: "#f8fafc", padding: "4px 7px", borderRadius: "6px", marginTop: "2px", border: "1px solid #f1f5f9" }}>
                        <span style={{ color: "#64748b" }}>Market Avg</span>
                        <span style={{ fontWeight: "700", color: (summary?.disputeRate ?? 0) <= (benchmark?.avgDisputeRate ?? 0.5) ? "#16a34a" : "#dc2626" }}>
                          {benchmark?.avgDisputeRate ?? 0.5}% ({((benchmark?.avgDisputeRate ?? 0.5) - (summary?.disputeRate ?? 0)) >= 0 ? `${((benchmark?.avgDisputeRate ?? 0.5) - (summary?.disputeRate ?? 0)).toFixed(1)}% better` : `${((summary?.disputeRate ?? 0) - (benchmark?.avgDisputeRate ?? 0.5)).toFixed(1)}% higher`})
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", paddingTop: "10px", marginTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "11px", fontWeight: "600", color: "#16a34a" }}>
                  <CheckCircle2 size={12} />
                  <span>{totalDisputesCount === 0 ? "Zero disputes logged" : `${totalDisputesCount} active disputes`}</span>
                </div>
              </div>

              {/* 5. Seller History Card (Purple Theme - 10%) */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "12px",
                  padding: "16px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  transition: "all 0.15s ease",
                }}
              >
                <div>
                  {/* Header */}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: "#f3e8ff",
                          color: "#9333ea",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Clock size={16} />
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Seller History</div>
                        <div style={{ fontSize: "10.5px", color: "#64748b" }}>10% of score</div>
                      </div>
                    </div>

                    <span
                      style={{
                        backgroundColor: "#f3e8ff",
                        color: "#9333ea",
                        borderRadius: "6px",
                        padding: "2px 7px",
                        fontSize: "11.5px",
                        fontWeight: "700",
                        border: "1px solid #e9d5ff",
                      }}
                    >
                      {historyScore}/100
                    </span>
                  </div>

                  {/* Submetrics */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "11.5px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Time on store</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, Math.round(storeAgeDays / 4))}%`, height: "100%", backgroundColor: "#9333ea" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{timeOnPlatformFormatted}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Suppliers</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, suppliers.length * 25)}%`, height: "100%", backgroundColor: "#9333ea" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>{suppliers.length}</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b" }}>Violations</span>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ width: "42px", height: "4px", backgroundColor: "#f1f5f9", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{ width: "0%", height: "100%", backgroundColor: "#9333ea" }} />
                        </div>
                        <span style={{ fontWeight: "700", color: "#0f172a" }}>None</span>
                      </div>
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "10.5px", backgroundColor: "#f8fafc", padding: "4px 7px", borderRadius: "6px", marginTop: "2px", border: "1px solid #f1f5f9" }}>
                      <span style={{ color: "#64748b" }}>Store Age</span>
                      <span style={{ fontWeight: "700", color: "#0f172a" }}>{storeAgeDays} days</span>
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: "flex", alignItems: "center", gap: "5px", paddingTop: "10px", marginTop: "12px", borderTop: "1px solid #f1f5f9", fontSize: "11px", fontWeight: "600", color: "#16a34a" }}>
                  <CheckCircle2 size={12} />
                  <span>Verified Shopify Store</span>
                </div>
              </div>

            </div>

            {/* Modal Bottom Security Notice */}
            <div
              style={{
                backgroundColor: "#f8fafc",
                border: "1px solid #e2e8f0",
                borderRadius: "10px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "11.5px",
                color: "#64748b",
              }}
            >
              <Lock size={13} color="#2563eb" style={{ flexShrink: 0 }} />
              <span>
                <strong>Standardized Algorithm:</strong> Pillar weights are fixed by TrustLayer to ensure fair, verified trust scores across all merchants.
              </span>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
