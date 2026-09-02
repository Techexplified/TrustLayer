import { useState, useRef, useEffect, Fragment } from "react";
import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useSearchParams, useNavigation, useLocation } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStoreOverviewData } from "../lib/storeMetrics.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Check if user exists in DB and if onboarding is already completed
  const settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  // If user does not exist in DB or onboarding is not completed, redirect to /app/onboarding
  if (!settings || !settings.onboardingCompleted) {
    const url = new URL(request.url);
    return redirect(`/app/onboarding${url.search}`);
  }

  // 2. User is onboarded: collect latest real vendor data and compute overview metrics for selected period (default 7d)
  const url = new URL(request.url);
  const range = (url.searchParams.get("range") as "7d" | "30d" | "90d") || "7d";
  const days = range === "90d" ? 90 : range === "30d" ? 30 : 7;

  const overviewData = await getStoreOverviewData(admin, shop, days);

  return {
    ...overviewData,
    selectedRange: range,
  };
};

// ── Sparkline Helper ──
function Sparkline({
  type = "up-green",
}: {
  type?: "up-green" | "down-orange" | "up-purple" | "down-green" | "neutral";
}) {
  let strokeColor = "#16a34a";
  let pathD = "M 0 16 C 30 14, 60 10, 90 2";

  if (type === "up-green") {
    strokeColor = "#16a34a";
    pathD = "M 0 18 C 30 16, 55 12, 90 4";
  } else if (type === "down-orange") {
    strokeColor = "#f59e0b";
    pathD = "M 0 4 C 35 6, 60 12, 90 18";
  } else if (type === "up-purple") {
    strokeColor = "#6366f1";
    pathD = "M 0 18 C 30 15, 60 10, 90 3";
  } else if (type === "down-green") {
    strokeColor = "#16a34a";
    pathD = "M 0 4 C 30 8, 60 14, 90 18";
  } else if (type === "neutral") {
    strokeColor = "#94a3b8";
    pathD = "M 0 10 L 90 10";
  }

  return (
    <div style={{ marginTop: "12px", width: "100%", height: "20px", overflow: "hidden" }}>
      <svg
        viewBox="0 0 90 20"
        style={{ width: "100%", height: "100%", display: "block" }}
        preserveAspectRatio="none"
      >
        <path
          d={pathD}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export default function Index() {
  const loaderData = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const location = useLocation();
  const isDateRangeLoading =
    (navigation.state === "loading" || navigation.state === "submitting") &&
    navigation.location != null &&
    navigation.location.pathname === location.pathname &&
    Boolean(new URLSearchParams(navigation.location.search).get("range"));

  const shop = loaderData?.shop || "";
  const settings = loaderData?.settings;
  const suppliers = loaderData?.suppliers || [];
  const summary = loaderData?.summary;
  const alerts = loaderData?.alerts || [];

  // Read pending range only during in-page date range transitions
  const pendingRange = isDateRangeLoading && navigation.location
    ? (new URLSearchParams(navigation.location.search).get("range") as "7d" | "30d" | "90d")
    : null;

  const dateRange =
    pendingRange ||
    (searchParams.get("range") as "7d" | "30d" | "90d") ||
    loaderData?.selectedRange ||
    "7d";
  const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
  const [isStoreMenuOpen, setIsStoreMenuOpen] = useState(false);
  const [expandedVendor, setExpandedVendor] = useState<string | null>(null);
  const [visibleProductsCount, setVisibleProductsCount] = useState<Record<string, number>>({});

  const handleLoadMore = (vendorName: string) => {
    setVisibleProductsCount((prev) => ({
      ...prev,
      [vendorName]: (prev[vendorName] || 5) + 5,
    }));
  };

  const dateMenuRef = useRef<HTMLDivElement>(null);
  const storeMenuRef = useRef<HTMLDivElement>(null);

  const handleDateRangeSelect = (r: "7d" | "30d" | "90d") => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("range", r);
      return next;
    });
    setIsDateMenuOpen(false);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dateMenuRef.current && !dateMenuRef.current.contains(event.target as Node)) {
        setIsDateMenuOpen(false);
      }
      if (storeMenuRef.current && !storeMenuRef.current.contains(event.target as Node)) {
        setIsStoreMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsDateMenuOpen(false);
        setIsStoreMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const dateLabel =
    dateRange === "7d"
      ? "Last 7 days"
      : dateRange === "90d"
      ? "Last 90 days"
      : "Last 30 days";

  const storeInitial = settings?.storeName
    ? settings.storeName.charAt(0).toUpperCase()
    : "S";

  const totalSuppliersCount = suppliers.length;
  const displayTrustScore = summary?.marketplaceTrustScore ?? null;

  return (
    <div
      style={{
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        padding: "28px 36px 56px 36px",
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
          <span>Fetching latest data for {dateLabel.toLowerCase()}...</span>
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
          {/* Title & Subtitle */}
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
              Overview
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                margin: "4px 0 0 0",
              }}
            >
              Real-time supplier performance and trust metrics for {settings?.storeName || shop}.
            </p>
          </div>

          {/* Right Controls: Date Range & Store Selector */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {/* 1. Date Range Dropdown */}
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
                  transition: "all 0.15s ease",
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
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#64748b"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="3" y1="10" x2="21" y2="10"></line>
                  </svg>
                )}
                <span>{isDateRangeLoading ? "Fetching..." : dateLabel}</span>
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: isDateMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                  }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
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
                  }}
                >
                  {(["7d", "30d", "90d"] as const).map((r) => {
                    const label =
                      r === "7d"
                        ? "Last 7 days"
                        : r === "90d"
                        ? "Last 90 days"
                        : "Last 30 days";
                    const isSelected = dateRange === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => handleDateRangeSelect(r)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 10px",
                          fontSize: "12px",
                          fontWeight: isSelected ? "700" : "500",
                          color: isSelected ? "#2563eb" : "#334155",
                          backgroundColor: isSelected ? "#eff6ff" : "transparent",
                          border: "none",
                          borderRadius: "6px",
                          cursor: "pointer",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Store Profile Badge / Switcher */}
            <div ref={storeMenuRef} style={{ position: "relative" }}>
              <button
                type="button"
                onClick={() => setIsStoreMenuOpen(!isStoreMenuOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "9px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "5px 12px",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                  textAlign: "left",
                }}
              >
                <div
                  style={{
                    width: "28px",
                    height: "28px",
                    borderRadius: "6px",
                    backgroundColor: "#65a30d",
                    color: "#ffffff",
                    fontWeight: "800",
                    fontSize: "13px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {storeInitial}
                </div>

                <div>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: "700",
                      color: "#0f172a",
                      lineHeight: "1.2",
                    }}
                  >
                    {settings?.storeName || "My Store"}
                  </div>
                  <div
                    style={{
                      fontSize: "10.5px",
                      color: "#64748b",
                      marginTop: "1px",
                      lineHeight: "1.1",
                    }}
                  >
                    {totalSuppliersCount} {totalSuppliersCount === 1 ? "Supplier" : "Suppliers"} Tracked
                  </div>
                </div>

                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#94a3b8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{
                    transform: isStoreMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.15s ease",
                    marginLeft: "2px",
                  }}
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {isStoreMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    right: 0,
                    backgroundColor: "#ffffff",
                    border: "1px solid #e2e8f0",
                    borderRadius: "8px",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.08)",
                    padding: "10px 12px",
                    zIndex: 50,
                    minWidth: "180px",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#64748b" }}>Connected Domain:</div>
                  <div style={{ fontSize: "12px", fontWeight: "700", color: "#0f172a", marginTop: "2px" }}>
                    {shop}
                  </div>
                  <div
                    style={{
                      marginTop: "8px",
                      paddingTop: "8px",
                      borderTop: "1px solid #f1f5f9",
                      fontSize: "11px",
                      color: "#16a34a",
                      fontWeight: "600",
                    }}
                  >
                    ✓ TrustLayer Live Sync
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── SECTION 1: OVERVIEW METRICS (100% Real DB Data) ── */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            padding: "20px 24px 24px 24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h2
              style={{
                fontSize: "15px",
                fontWeight: "700",
                color: "#0f172a",
                margin: 0,
              }}
            >
              Overview
            </h2>
            <p
              style={{
                fontSize: "12px",
                color: "#64748b",
                margin: "2px 0 0 0",
              }}
            >
              Live aggregated metrics across all connected suppliers
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: "14px",
            }}
          >
            {/* Card 1: Marketplace Trust Score */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Marketplace Trust Score
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: displayTrustScore !== null && displayTrustScore >= 75 ? "#0f172a" : displayTrustScore === null ? "#94a3b8" : "#d97706",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {displayTrustScore !== null ? (
                    <>
                      {displayTrustScore}{" "}
                      <span style={{ fontSize: "13.5px", color: "#94a3b8", fontWeight: "600" }}>
                        /100
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: "20px" }}>— Unrated</span>
                  )}
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: displayTrustScore !== null && displayTrustScore >= 75 ? "#16a34a" : displayTrustScore === null ? "#94a3b8" : "#d97706",
                    fontWeight: "600",
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                  }}
                >
                  <span>{displayTrustScore === null ? "—" : displayTrustScore >= 75 ? "✓" : "!"}</span>
                  <span>{displayTrustScore === null ? `No sales in ${dateLabel.toLowerCase()}` : displayTrustScore >= 75 ? "Healthy Rating" : "Needs Review"}</span>
                </div>
              </div>
              <Sparkline type={displayTrustScore !== null && displayTrustScore >= 75 ? "up-green" : "neutral"} />
            </div>

            {/* Card 2: Sellers with Good Performance */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Sellers with Good Performance
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.goodPerformancePct ?? 0}%
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: "#64748b",
                    fontWeight: "500",
                  }}
                >
                  {(() => {
                    const activeSellers = suppliers.filter((s) => s.completedOrders > 0);
                    const goodCount = activeSellers.filter((s) => s.status === "GOOD").length;
                    return activeSellers.length > 0
                      ? `${goodCount} of ${activeSellers.length} active sellers`
                      : `No completed orders in ${dateLabel.toLowerCase()}`;
                  })()}
                </div>
              </div>
              <Sparkline type={summary?.goodPerformancePct ? "up-green" : "neutral"} />
            </div>

            {/* Card 3: Sellers Needing Attention */}
            <div
              style={{
                border: summary?.needingAttentionCount ? "1.5px solid #fde68a" : "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Sellers Needing Attention
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: (summary?.needingAttentionCount ?? 0) > 0 ? "#d97706" : "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.needingAttentionCount ?? 0}
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: (summary?.needingAttentionCount ?? 0) > 0 ? "#dc2626" : "#16a34a",
                    fontWeight: "600",
                  }}
                >
                  {(summary?.needingAttentionCount ?? 0) > 0 ? "Review recommended" : `✓ No critical sellers in ${dateLabel.toLowerCase()}`}
                </div>
              </div>
              <Sparkline type={(summary?.needingAttentionCount ?? 0) > 0 ? "down-orange" : "neutral"} />
            </div>

            {/* Card 4: Eligible for Trust Badge */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Eligible for Trust Badge
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.eligibleBadgeCount ?? 0}
                </div>
                <div
                  style={{
                    fontSize: "11.5px",
                    color: "#6366f1",
                    fontWeight: "600",
                  }}
                >
                  {settings?.badgeEnabled ? "✓ Storefront badge enabled" : "Badge disabled"}
                </div>
              </div>
              <Sparkline type="up-purple" />
            </div>
          </div>
        </div>

        {/* ── SECTION 2: PERFORMANCE SUMMARY (100% Real DB Data) ── */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            padding: "20px 24px 24px 24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div style={{ marginBottom: "16px" }}>
            <h2
              style={{
                fontSize: "15px",
                fontWeight: "700",
                color: "#0f172a",
                margin: 0,
              }}
            >
              Performance Summary
            </h2>
            <p
              style={{
                fontSize: "12px",
                color: "#64748b",
                margin: "2px 0 0 0",
              }}
            >
              Weighted factors impacting marketplace trust
            </p>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
              gap: "14px",
            }}
          >
            {/* 1. Product Reviews & CSAT (35% Weight) */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "3px solid #f59e0b",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Customer Satisfaction
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: summary?.csatRating === null ? "#94a3b8" : "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                    display: "flex",
                    alignItems: "baseline",
                    gap: "4px",
                  }}
                >
                  {summary?.csatRating !== null && summary?.csatRating !== undefined && summary.csatRating > 0 ? (
                    <>
                      <span>{summary.csatRating}</span>
                      <span style={{ fontSize: "14px", color: "#f59e0b" }}>⭐</span>
                      <span style={{ fontSize: "13.5px", color: "#94a3b8", fontWeight: "600" }}>
                        /5
                      </span>
                    </>
                  ) : (
                    <span style={{ fontSize: "20px" }}>0.0 ⭐</span>
                  )}
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                   Verified buyer reviews
                </div>
              </div>
              <Sparkline type={summary?.csatRating != null && summary.csatRating > 0 ? "up-green" : "neutral"} />
            </div>

            {/* 2. On-time Delivery Rate (20% Weight) */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "3px solid #3b82f6",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  On-time Delivery Rate
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: summary?.onTimeDeliveryRate === null ? "#94a3b8" : "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.onTimeDeliveryRate !== null && summary?.onTimeDeliveryRate !== undefined
                    ? `${summary.onTimeDeliveryRate}%`
                    : "—"}
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {summary?.onTimeDeliveryRate === null
                    ? `No fulfilled orders in ${dateLabel.toLowerCase()}`
                    : `Dispatch < 48hrs`}
                </div>
              </div>
              <Sparkline type={summary?.onTimeDeliveryRate != null && summary.onTimeDeliveryRate > 0 ? "up-green" : "neutral"} />
            </div>

            {/* 3. Return / Refund Rate (20% Weight) */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "3px solid #10b981",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Return / Refund Rate
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: (summary?.returnRate ?? 0) > 5 ? "#dc2626" : "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.returnRate ?? 0.0}%
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {/* Weight: 20% */}
                   Target &lt; 3%
                </div>
              </div>
              <Sparkline type={(summary?.returnRate ?? 0) > 5 ? "down-orange" : "down-green"} />
            </div>

            {/* 4. Dispute Rate (15% Weight) */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "3px solid #d97706",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Dispute Rate
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: (summary?.disputeRate ?? 0) > 2 ? "#dc2626" : "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {summary?.disputeRate ?? 0.0}%
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                  {/* Weight: 15%  */}
                  Target &lt; 1%
                </div>
              </div>
              <Sparkline type="neutral" />
            </div>

            {/* 5. Seller History (10% Weight) */}
            {/* <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "3px solid #8b5cf6",
                borderRadius: "12px",
                padding: "16px 18px",
                backgroundColor: "#ffffff",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
              >
              <div>
                <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "500" }}>
                  Seller History
                </div>
                <div
                  style={{
                    fontSize: "30px",
                    fontWeight: "800",
                    color: "#0f172a",
                    lineHeight: "1.1",
                    margin: "8px 0 6px 0",
                  }}
                >
                  {settings?.storeAgeDays ? (settings.storeAgeDays > 365 ? `${Math.floor(settings.storeAgeDays / 365)}yr ${Math.floor((settings.storeAgeDays % 365) / 30)}m` : `${settings.storeAgeDays}d`) : "Verified"}
                </div>
                <div style={{ fontSize: "11.5px", color: "#64748b" }}>
                  Weight: 10% · Store presence
                </div>
              </div>
              <Sparkline type="up-purple" />
            </div> */}
          </div>
        </div>

        {/* ── SECTION 3: RECENT CHANGES & ALERTS (Real DB Alerts) ── */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            padding: "20px 24px 24px 24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "14px",
            }}
          >
            <h2
              style={{
                fontSize: "15px",
                fontWeight: "700",
                color: "#0f172a",
                margin: 0,
              }}
            >
              Recent Changes & Alerts
            </h2>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              {alerts.length} {alerts.length === 1 ? "alert" : "alerts"} logged
            </div>
          </div>

          {alerts.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {alerts.map((alert) => {
                const isHigh = alert.severity === "HIGH";
                const isMed = alert.severity === "MEDIUM";
                const bg = isHigh ? "#fef2f2" : isMed ? "#fffbeb" : "#f0fdf4";
                const border = isHigh ? "#fee2e2" : isMed ? "#fef3c7" : "#dcfce7";
                const iconColor = isHigh ? "#dc2626" : isMed ? "#d97706" : "#16a34a";

                return (
                  <div
                    key={alert.id}
                    style={{
                      backgroundColor: bg,
                      border: `1px solid ${border}`,
                      borderRadius: "10px",
                      padding: "12px 16px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "8px",
                          backgroundColor: border,
                          color: iconColor,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          fontWeight: "700",
                        }}
                      >
                        {isHigh ? "!" : isMed ? "⚠" : "✓"}
                      </div>
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                          {alert.title}
                        </div>
                        <div style={{ fontSize: "11.5px", color: "#475569", marginTop: "2px" }}>
                          {alert.description}
                        </div>
                      </div>
                    </div>

                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "500" }}>
                      {new Date(alert.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                backgroundColor: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: "10px",
                padding: "24px",
                textAlign: "center",
                color: "#64748b",
              }}
            >
              <div style={{ fontSize: "20px", marginBottom: "6px" }}>✓</div>
              <div style={{ fontSize: "13.5px", fontWeight: "600", color: "#334155" }}>
                All sellers are operating within healthy parameters.
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
                No critical return spikes or delivery delays detected.
              </div>
            </div>
          )}
        </div>

        {/* ── SECTION 4: CONNECTED SUPPLIERS TABLE (100% Real DB Records) ── */}
        <div
          style={{
            backgroundColor: "#ffffff",
            borderRadius: "14px",
            border: "1px solid #e2e8f0",
            padding: "20px 24px 24px 24px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "15px",
                  fontWeight: "700",
                  color: "#0f172a",
                  margin: 0,
                }}
              >
                Tracked Suppliers & Vendors
              </h2>
              <p
                style={{
                  fontSize: "12px",
                  color: "#64748b",
                  margin: "2px 0 0 0",
                }}
              >
                Real-time performance scores for products and orders in your store
              </p>
            </div>
            <div style={{ fontSize: "12px", fontWeight: "600", color: "#2563eb" }}>
              {suppliers.length} {suppliers.length === 1 ? "Supplier" : "Suppliers"}
            </div>
          </div>

          {suppliers.length > 0 ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12.5px" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left", color: "#64748b" }}>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Vendor Name</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Trust Score</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Products</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Orders</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Fulfilled</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Units Sold</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Returns</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>On-time Delivery</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Return Rate</th>
                    <th style={{ padding: "10px 12px", fontWeight: "600" }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((supplier) => {
                    const isExpanded = expandedVendor === supplier.vendorName;
                    const hasOrders = supplier.totalOrders > 0;
                    const isGood = supplier.status === "GOOD";
                    const isWarning = supplier.status === "NEEDS_ATTENTION";
                    const statusBg = !hasOrders ? "#f8fafc" : isGood ? "#f0fdf4" : isWarning ? "#fffbeb" : "#fef2f2";
                    const statusColor = !hasOrders ? "#475569" : isGood ? "#16a34a" : isWarning ? "#d97706" : "#dc2626";

                    return (
                      <Fragment key={supplier.vendorName}>
                        <tr
                          onClick={() => setExpandedVendor(isExpanded ? null : supplier.vendorName)}
                          style={{
                            borderBottom: isExpanded ? "none" : "1px solid #f1f5f9",
                            backgroundColor: isExpanded ? "#f8fafc" : "transparent",
                            cursor: "pointer",
                            transition: "background-color 0.15s ease",
                          }}
                        >
                          <td style={{ padding: "12px", fontWeight: "700", color: "#0f172a" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <span
                                style={{
                                  fontSize: "9px",
                                  color: isExpanded ? "#2563eb" : "#94a3b8",
                                  transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)",
                                  transition: "transform 0.2s ease",
                                  display: "inline-block",
                                }}
                              >
                                ▶
                              </span>
                              <span>{supplier.vendorName}</span>
                            </div>
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "2px 8px",
                                borderRadius: "6px",
                                fontSize: "12px",
                                fontWeight: "700",
                                backgroundColor:
                                  supplier.trustScore === null
                                    ? "#f8fafc"
                                    : supplier.trustScore >= 75
                                    ? "#eff6ff"
                                    : "#fffbeb",
                                color:
                                  supplier.trustScore === null
                                    ? "#94a3b8"
                                    : supplier.trustScore >= 75
                                    ? "#2563eb"
                                    : "#d97706",
                                border: supplier.trustScore === null ? "1px solid #e2e8f0" : "none",
                              }}
                            >
                              {supplier.trustScore !== null ? `${supplier.trustScore} / 100` : "— Unrated"}
                            </span>
                          </td>
                          <td style={{ padding: "12px", color: "#334155" }}>{supplier.totalProducts}</td>
                          <td style={{ padding: "12px", color: "#334155" }}>{supplier.totalOrders}</td>
                          <td style={{ padding: "12px", color: "#334155" }}>
                            <span style={{ fontWeight: supplier.completedOrders > 0 ? "600" : "400" }}>
                              {supplier.completedOrders}
                            </span>
                          </td>
                          <td style={{ padding: "12px", color: "#334155" }}>{supplier.totalUnitsSold}</td>
                          <td style={{ padding: "12px", color: supplier.refundedUnitsCount > 0 ? "#dc2626" : "#334155" }}>
                            {supplier.refundedUnitsCount}
                          </td>
                          <td style={{ padding: "12px", color: "#334155" }}>
                            {supplier.onTimeDeliveryRate !== null ? `${supplier.onTimeDeliveryRate}%` : "—"}
                          </td>
                          <td style={{ padding: "12px", color: supplier.returnRate > 5 ? "#dc2626" : "#334155" }}>
                            {supplier.completedOrders > 0 ? `${supplier.returnRate}%` : "—"}
                          </td>
                          <td style={{ padding: "12px" }}>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "4px",
                                padding: "3px 8px",
                                borderRadius: "6px",
                                fontSize: "11px",
                                fontWeight: "700",
                                backgroundColor: statusBg,
                                color: statusColor,
                                border: !hasOrders ? "1px solid #e2e8f0" : "none",
                              }}
                            >
                              {!hasOrders ? "● New Seller" : isGood ? "● Good" : isWarning ? "● Attention" : "● Critical"}
                            </span>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr style={{ backgroundColor: "#f8fafc", borderBottom: "2px solid #e2e8f0" }}>
                            <td colSpan={10} style={{ padding: "0 18px 18px 18px" }}>
                              <div
                                style={{
                                  backgroundColor: "#ffffff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "10px",
                                  padding: "16px 20px",
                                  boxShadow: "0 2px 6px rgba(0,0,0,0.03)",
                                }}
                              >
                                {/* Header summary for this vendor */}
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    borderBottom: "1px solid #f1f5f9",
                                    paddingBottom: "12px",
                                    marginBottom: "14px",
                                    flexWrap: "wrap",
                                    gap: "10px",
                                  }}
                                >
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
                                        fontSize: "16px",
                                        fontWeight: "700",
                                      }}
                                    >
                                      🛍️
                                    </div>
                                    <div>
                                      <div style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a" }}>
                                        {supplier.vendorName} — Product Reviews & Rating
                                      </div>
                                      <div style={{ fontSize: "11.5px", color: "#64748b", marginTop: "1px" }}>
                                        Customer ratings and reviews across all {supplier.totalProducts} catalog listings
                                      </div>
                                    </div>
                                  </div>

                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                    <div
                                      style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "5px",
                                        backgroundColor: supplier.avgProductRating !== null ? "#fef3c7" : "#f1f5f9",
                                        color: supplier.avgProductRating !== null ? "#b45309" : "#475569",
                                        border: supplier.avgProductRating !== null ? "1px solid #fde68a" : "1px solid #e2e8f0",
                                        padding: "4px 10px",
                                        borderRadius: "20px",
                                        fontSize: "12px",
                                        fontWeight: "700",
                                      }}
                                    >
                                      <span>⭐</span>
                                      <span>
                                        {supplier.avgProductRating !== null
                                          ? `${supplier.avgProductRating} / 5.0`
                                          : "0 / 5.0"}
                                      </span>
                                    </div>

                                    <div
                                      style={{
                                        backgroundColor: "#f1f5f9",
                                        color: "#475569",
                                        padding: "4px 10px",
                                        borderRadius: "20px",
                                        fontSize: "11.5px",
                                        fontWeight: "600",
                                      }}
                                    >
                                      {supplier.totalReviewCount || 0} {(supplier.totalReviewCount || 0) === 1 ? "Review" : "Reviews"}
                                    </div>
                                  </div>
                                </div>

                                {/* Products Review List (Batched in 5s with Load More) */}
                                {supplier.products && supplier.products.length > 0 ? (
                                  <div>
                                    {(() => {
                                      const limit = visibleProductsCount[supplier.vendorName] || 5;
                                      const displayedProducts = supplier.products.slice(0, limit);
                                      const hasMore = supplier.products.length > limit;
                                      const remaining = supplier.products.length - limit;

                                      return (
                                        <>
                                          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                            {displayedProducts.map((prod) => {
                                              const hasRating = prod.rating !== null;
                                              const isHighRating = hasRating && (prod.rating as number) >= 4.5;
                                              const isMedRating = hasRating && (prod.rating as number) >= 4.0;

                                              return (
                                                <div
                                                  key={prod.productId}
                                                  style={{
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    backgroundColor: "#f8fafc",
                                                    border: "1px solid #e2e8f0",
                                                    borderRadius: "8px",
                                                    padding: "10px 14px",
                                                    fontSize: "12px",
                                                  }}
                                                >
                                                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                                    <span style={{ fontSize: "16px" }}>📦</span>
                                                    <div>
                                                      <div style={{ fontWeight: "700", color: "#0f172a" }}>
                                                        {prod.title}
                                                      </div>
                                                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>
                                                        Inventory: {prod.inventoryQuantity} in stock · Status: {prod.status.toLowerCase()}
                                                      </div>
                                                    </div>
                                                  </div>

                                                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                                                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                                                      <span style={{ color: hasRating ? "#f59e0b" : "#94a3b8" }}>
                                                        {hasRating ? "★".repeat(Math.round(prod.rating as number)) + "☆".repeat(5 - Math.round(prod.rating as number)) : "☆☆☆☆☆"}
                                                      </span>
                                                      <span style={{ fontWeight: "700", color: "#0f172a" }}>
                                                        {hasRating ? `${prod.rating} ★` : "Unrated"}
                                                      </span>
                                                    </div>

                                                    <span
                                                      style={{
                                                        backgroundColor: "#ffffff",
                                                        border: "1px solid #cbd5e1",
                                                        borderRadius: "12px",
                                                        padding: "2px 8px",
                                                        fontSize: "11px",
                                                        fontWeight: "600",
                                                        color: "#475569",
                                                      }}
                                                    >
                                                      {prod.reviewCount} {prod.reviewCount === 1 ? "review" : "reviews"}
                                                    </span>

                                                    <span
                                                      style={{
                                                        backgroundColor: isHighRating
                                                          ? "#ecfdf5"
                                                          : isMedRating
                                                          ? "#eff6ff"
                                                          : hasRating
                                                          ? "#fffbeb"
                                                          : "#f1f5f9",
                                                        color: isHighRating
                                                          ? "#059669"
                                                          : isMedRating
                                                          ? "#2563eb"
                                                          : hasRating
                                                          ? "#d97706"
                                                          : "#64748b",
                                                        borderRadius: "6px",
                                                        padding: "2px 8px",
                                                        fontSize: "10.5px",
                                                        fontWeight: "700",
                                                      }}
                                                    >
                                                      {isHighRating
                                                        ? "Top Rated"
                                                        : isMedRating
                                                        ? "Good Quality"
                                                        : hasRating
                                                        ? "Watchlist"
                                                        : "New Listing"}
                                                    </span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>

                                          {/* Load More Button */}
                                          {hasMore && (
                                            <div style={{ display: "flex", justifyContent: "center", marginTop: "12px" }}>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleLoadMore(supplier.vendorName);
                                                }}
                                                style={{
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                  backgroundColor: "#ffffff",
                                                  border: "1px solid #cbd5e1",
                                                  borderRadius: "8px",
                                                  padding: "7px 16px",
                                                  fontSize: "12px",
                                                  fontWeight: "700",
                                                  color: "#2563eb",
                                                  cursor: "pointer",
                                                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                                                  transition: "all 0.15s ease",
                                                }}
                                              >
                                                <span>⬇ Load More Products ({Math.min(5, remaining)} more · {remaining} remaining)</span>
                                              </button>
                                            </div>
                                          )}

                                          {!hasMore && supplier.products.length > 5 && (
                                            <div style={{ textAlign: "center", fontSize: "11px", color: "#94a3b8", marginTop: "10px" }}>
                                              ✓ Showing all {supplier.products.length} products
                                            </div>
                                          )}
                                        </>
                                      );
                                    })()}
                                  </div>
                                ) : (
                                  <div
                                    style={{
                                      padding: "16px",
                                      textAlign: "center",
                                      color: "#64748b",
                                      fontSize: "12px",
                                      backgroundColor: "#f8fafc",
                                      borderRadius: "8px",
                                    }}
                                  >
                                    No specific products found under vendor &quot;{supplier.vendorName}&quot;.
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div
              style={{
                backgroundColor: "#f8fafc",
                border: "1px dashed #cbd5e1",
                borderRadius: "10px",
                padding: "32px",
                textAlign: "center",
                color: "#64748b",
              }}
            >
              <div style={{ fontSize: "24px", marginBottom: "8px" }}>📦</div>
              <div style={{ fontSize: "14px", fontWeight: "700", color: "#1e293b" }}>
                No Vendors or Products Found
              </div>
              <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "4px", maxWidth: "420px", margin: "4px auto 0 auto" }}>
                When you create products in your Shopify store with vendor names or receive customer orders, TrustLayer will automatically sync and rank them here.
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
