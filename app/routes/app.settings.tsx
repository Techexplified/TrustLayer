import { useState, useRef, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { getStoreOverviewData, invalidateStoreOverviewCache } from "../lib/storeMetrics.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (!settings || !settings.onboardingCompleted) {
    const url = new URL(request.url);
    return redirect(`/app/onboarding${url.search}`);
  }

  const overviewData = await getStoreOverviewData(admin, shop, 7);

  // Calculate completed orders & storeAgeDays for eligibility check (20 orders & 30 days active store)
  const completedOrders = (overviewData.suppliers as Array<{ completedOrders?: number }>).reduce(
    (sum, v) => sum + (v.completedOrders || 0),
    0
  );
  const completedOrdersCount = Math.max(settings.completedOrdersCount || 0, completedOrders);

  let storeAgeDays = settings.storeAgeDays || 0;
  if (storeAgeDays === 0) {
    const ref = (settings as { storeCreatedAt?: Date | null }).storeCreatedAt ?? settings.createdAt;
    storeAgeDays = Math.max(1, Math.floor((Date.now() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24)));
  }

  const isEligible = completedOrdersCount >= 20 && storeAgeDays >= 30;

  return {
    shop,
    settings,
    summary: overviewData.summary,
    isEligible,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const badgeEnabled = formData.get("badgeEnabled") === "true";
  const showOnProductPages = formData.get("showOnProductPages") === "true";
  const showOnSellerProfile = formData.get("showOnSellerProfile") === "true";
  const showOnCartPage = formData.get("showOnCartPage") === "true";
  const showProductReviews = formData.get("showProductReviews") === "true";
  const badgePlacement = (formData.get("badgePlacement") as string) || "PRODUCT_PAGE_BELOW_ATC";
  const badgeStyle = (formData.get("badgeStyle") as string) || "FULL";
  const compactMode = formData.get("compactMode") === "true";
  const showNumericScore = formData.get("showNumericScore") === "true";

  const updated = await prisma.appSettings.update({
    where: { shop },
    data: {
      badgeEnabled,
      showOnProductPages,
      showOnSellerProfile,
      showOnCartPage,
      showProductReviews,
      badgePlacement,
      badgeStyle,
      compactMode,
      showNumericScore,
      updatedAt: new Date(),
    },
  });

  invalidateStoreOverviewCache(shop);

  return { success: true, settings: updated };
};

export default function WidgetSettings() {
  const { shop, settings, summary, isEligible } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();

  // Stored saved state
  const [savedConfig, setSavedConfig] = useState({
    badgeEnabled: (settings as { badgeEnabled?: boolean } | null)?.badgeEnabled ?? true,
    showOnProductPages: (settings as { showOnProductPages?: boolean } | null)?.showOnProductPages ?? true,
    showOnSellerProfile: (settings as { showOnSellerProfile?: boolean } | null)?.showOnSellerProfile ?? true,
    showOnCartPage: (settings as { showOnCartPage?: boolean } | null)?.showOnCartPage ?? false,
    showProductReviews: (settings as { showProductReviews?: boolean } | null)?.showProductReviews ?? true,
    badgePlacement: settings?.badgePlacement ?? "PRODUCT_PAGE_BELOW_ATC",
    badgeStyle: (settings?.badgeStyle as "FULL" | "COMPACT" | "MINIMAL") || "FULL",
    compactMode: settings?.compactMode ?? false,
    showNumericScore: settings?.showNumericScore ?? true,
  });

  // Current working form state
  const [badgeEnabled, setBadgeEnabled] = useState(savedConfig.badgeEnabled);
  const [showOnProductPages, setShowOnProductPages] = useState(savedConfig.showOnProductPages);
  const [showOnSellerProfile, setShowOnSellerProfile] = useState(savedConfig.showOnSellerProfile);
  const [showOnCartPage, setShowOnCartPage] = useState(savedConfig.showOnCartPage);
  const [showProductReviews, setShowProductReviews] = useState(savedConfig.showProductReviews);
  const [badgePlacement, setBadgePlacement] = useState(savedConfig.badgePlacement);
  const [badgeStyle, setBadgeStyle] = useState<"FULL" | "COMPACT" | "MINIMAL">(savedConfig.badgeStyle);
  const [compactMode, setCompactMode] = useState(savedConfig.compactMode);
  const [showNumericScore, setShowNumericScore] = useState(savedConfig.showNumericScore);

  // UI state
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [previewTab, setPreviewTab] = useState<"product" | "cart">("product");
  const [isPositionMenuOpen, setIsPositionMenuOpen] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const positionMenuRef = useRef<HTMLDivElement>(null);

  // Sync saved config when fetcher finishes saving
  useEffect(() => {
    if (fetcher.data?.success && fetcher.data.settings) {
      const s = fetcher.data.settings as {
        badgeEnabled?: boolean;
        showOnProductPages: boolean;
        showOnSellerProfile: boolean;
        showOnCartPage: boolean;
        showProductReviews?: boolean;
        badgePlacement: string;
        badgeStyle: string;
        compactMode: boolean;
        showNumericScore: boolean;
      };
      const newConfig = {
        badgeEnabled: s.badgeEnabled ?? true,
        showOnProductPages: s.showOnProductPages,
        showOnSellerProfile: s.showOnSellerProfile,
        showOnCartPage: s.showOnCartPage,
        showProductReviews: s.showProductReviews ?? true,
        badgePlacement: s.badgePlacement,
        badgeStyle: (s.badgeStyle as "FULL" | "COMPACT" | "MINIMAL") || "FULL",
        compactMode: s.compactMode,
        showNumericScore: s.showNumericScore,
      };
      setSavedConfig(newConfig);
      setBadgeEnabled(newConfig.badgeEnabled);
      setShowOnProductPages(newConfig.showOnProductPages);
      setShowOnSellerProfile(newConfig.showOnSellerProfile);
      setShowOnCartPage(newConfig.showOnCartPage);
      setShowProductReviews(newConfig.showProductReviews);
      setBadgePlacement(newConfig.badgePlacement);
      setBadgeStyle(newConfig.badgeStyle);
      setCompactMode(newConfig.compactMode);
      setShowNumericScore(newConfig.showNumericScore);

      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [fetcher.data]);

  // Click outside position dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (positionMenuRef.current && !positionMenuRef.current.contains(event.target as Node)) {
        setIsPositionMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isSaving = fetcher.state === "submitting" || fetcher.state === "loading";

  // Check if form is dirty
  const isDirty =
    badgeEnabled !== savedConfig.badgeEnabled ||
    showOnProductPages !== savedConfig.showOnProductPages ||
    showOnSellerProfile !== savedConfig.showOnSellerProfile ||
    showOnCartPage !== savedConfig.showOnCartPage ||
    showProductReviews !== savedConfig.showProductReviews ||
    badgePlacement !== savedConfig.badgePlacement ||
    badgeStyle !== savedConfig.badgeStyle ||
    compactMode !== savedConfig.compactMode ||
    showNumericScore !== savedConfig.showNumericScore;

  const handleDiscard = () => {
    setBadgeEnabled(savedConfig.badgeEnabled);
    setShowOnProductPages(savedConfig.showOnProductPages);
    setShowOnSellerProfile(savedConfig.showOnSellerProfile);
    setShowOnCartPage(savedConfig.showOnCartPage);
    setShowProductReviews(savedConfig.showProductReviews);
    setBadgePlacement(savedConfig.badgePlacement);
    setBadgeStyle(savedConfig.badgeStyle);
    setCompactMode(savedConfig.compactMode);
    setShowNumericScore(savedConfig.showNumericScore);
  };

  const handleSave = () => {
    const fd = new FormData();
    fd.append("badgeEnabled", String(badgeEnabled));
    fd.append("showOnProductPages", String(showOnProductPages));
    fd.append("showOnSellerProfile", String(showOnSellerProfile));
    fd.append("showOnCartPage", String(showOnCartPage));
    fd.append("showProductReviews", String(showProductReviews));
    fd.append("badgePlacement", badgePlacement);
    fd.append("badgeStyle", badgeStyle);
    fd.append("compactMode", String(compactMode));
    fd.append("showNumericScore", String(showNumericScore));
    fetcher.submit(fd, { method: "post" });
  };

  // Position Labels
  const positionOptions = [
    { id: "PRODUCT_PAGE_BELOW_ATC", label: "Below Add to Cart", icon: "⬇" },
    { id: "PRODUCT_PAGE_ABOVE_ATC", label: "Above Add to Cart", icon: "⬆" },
    { id: "PRODUCT_PAGE_BELOW_DESC", label: "Below product description", icon: "📄" }
    // { id: "PRODUCT_PAGE_STICKY_BOTTOM", label: "Sticky bottom bar", icon: "📌" },
  ];

  const currentPositionObj =
    positionOptions.find((p) => p.id === badgePlacement) || positionOptions[0];

  // Derived real store values
  const storeName = settings?.storeName || shop || "ABC Fashion";
  const displayScore = summary?.marketplaceTrustScore ?? settings?.trustScore ?? 94;
  const tierName =
    displayScore >= 90
      ? "Excellent"
      : displayScore >= 75
      ? "Healthy"
      : displayScore >= 60
      ? "Needs Review"
      : "Critical";

  const onTimeRate = summary?.onTimeDeliveryRate ?? 96;
  const returnRate = summary?.returnRate ?? 2.1;
  const csatRating = summary?.csatRating ? Math.round((summary.csatRating / 5) * 100) : 98;

  const lastSavedTime = settings?.updatedAt
    ? new Date(settings.updatedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }) +
      " · " +
      new Date(settings.updatedAt).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Just now";

  return (
    <div
      style={{
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        padding: "24px 32px 64px 32px",
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes toastSlideUp {
          from { opacity: 0; transform: translate(-50%, 15px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        .widget-switch {
          position: relative;
          display: inline-block;
          width: 36px;
          height: 20px;
          cursor: pointer;
        }
        .widget-switch input {
          opacity: 0;
          width: 0;
          height: 0;
        }
        .widget-slider {
          position: absolute;
          cursor: pointer;
          top: 0; left: 0; right: 0; bottom: 0;
          background-color: #cbd5e1;
          transition: .2s ease;
          border-radius: 20px;
        }
        .widget-slider:before {
          position: absolute;
          content: "";
          height: 14px;
          width: 14px;
          left: 3px;
          bottom: 3px;
          background-color: white;
          transition: .2s ease;
          border-radius: 50%;
        }
        input:checked + .widget-slider {
          background-color: #4f46e5;
        }
        input:checked + .widget-slider:before {
          transform: translateX(16px);
        }
      `}</style>

      {/* Floating Success Toast */}
      {showToast && (
        <div
          style={{
            position: "fixed",
            bottom: "28px",
            left: "50%",
            transform: "translateX(-50%)",
            backgroundColor: "#0f172a",
            color: "#ffffff",
            borderRadius: "30px",
            padding: "10px 22px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            gap: "9px",
            fontSize: "13px",
            fontWeight: "600",
            zIndex: 99999,
            animation: "toastSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span style={{ color: "#10b981", fontSize: "16px" }}>✓</span>
          <span>Settings saved & published to store successfully!</span>
        </div>
      )}

      <div style={{ maxWidth: "1280px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
        
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
              Widget Settings
            </h1>
            <p
              style={{
                fontSize: "13px",
                color: "#64748b",
                margin: "4px 0 0 0",
              }}
            >
              Control how your TrustLayer badge and product reviews appear to shoppers
            </p>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                backgroundColor: "#ecfdf5",
                color: "#059669",
                border: "1px solid #a7f3d0",
                borderRadius: "20px",
                padding: "5px 12px",
                fontSize: "12px",
                fontWeight: "600",
              }}
            >
              <span>✓</span>
              <span>Last saved {lastSavedTime}</span>
            </div>

            {isEligible && (
              <button
                type="button"
                onClick={() => window.open(`https://${shop}`, "_blank")}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "8px",
                  padding: "7px 14px",
                  fontSize: "12.5px",
                  fontWeight: "600",
                  color: "#334155",
                  cursor: "pointer",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                <span>Preview on store</span>
              </button>
            )}
          </div>
        </div>

        {/* ── MAIN 2-COLUMN LAYOUT: (Left: Configuration, Right: Live Preview) ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "28px", alignItems: "start" }}>
          
          {/* ════════════ LEFT COLUMN: CONFIGURATION ════════════ */}
          <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
            
            {/* 0. MASTER TOGGLE: ENABLE BADGE */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: badgeEnabled ? "1.5px solid #3b82f6" : "1px solid #e2e8f0",
                padding: "18px 22px",
                boxShadow: badgeEnabled
                  ? "0 4px 12px -2px rgba(37, 99, 235, 0.08)"
                  : "0 1px 3px rgba(0,0,0,0.02)",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div
                    style={{
                      width: "42px",
                      height: "42px",
                      borderRadius: "10px",
                      backgroundColor: badgeEnabled ? "#eff6ff" : "#f1f5f9",
                      color: badgeEnabled ? "#2563eb" : "#64748b",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "20px",
                      flexShrink: 0,
                    }}
                  >
                    🛡️
                  </div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a" }}>
                        Enable Badge
                      </span>
                      <span
                        style={{
                          fontSize: "10.5px",
                          fontWeight: "700",
                          backgroundColor: badgeEnabled ? "#dcfce7" : "#f1f5f9",
                          color: badgeEnabled ? "#15803d" : "#64748b",
                          padding: "2px 8px",
                          borderRadius: "10px",
                        }}
                      >
                        {badgeEnabled ? "● Active on store" : "○ Turned off"}
                      </span>
                    </div>
                    <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>
                      Master switch to enable or disable the TrustLayer badge across your storefront
                    </div>
                  </div>
                </div>

                <div
                  role="switch"
                  aria-checked={badgeEnabled}
                  tabIndex={0}
                  onClick={() => setBadgeEnabled(!badgeEnabled)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setBadgeEnabled(!badgeEnabled);
                    }
                  }}
                  style={{
                    width: "48px",
                    height: "28px",
                    borderRadius: "14px",
                    backgroundColor: badgeEnabled ? "#2563eb" : "#cbd5e1",
                    padding: "3px",
                    display: "flex",
                    alignItems: "center",
                    cursor: "pointer",
                    transition: "background-color 0.2s ease",
                    boxSizing: "border-box",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      backgroundColor: "#ffffff",
                      boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      transform: badgeEnabled ? "translateX(20px)" : "translateX(0px)",
                      transition: "transform 0.2s ease",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* 1. DISPLAY SETTINGS */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                opacity: badgeEnabled ? 1 : 0.65,
                transition: "opacity 0.2s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "16px" }}>👁</span>
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                  Display Settings
                </h3>
              </div>
              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 16px 0" }}>
                Choose where and how your trust badge & product reviews show to buyers
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {/* Option 1: Product Pages */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    backgroundColor: showOnProductPages ? "#f8fafc" : "#ffffff",
                    border: `1px solid ${showOnProductPages ? "#cbd5e1" : "#e2e8f0"}`,
                    borderRadius: "10px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={showOnProductPages}
                      onChange={(e) => setShowOnProductPages(e.target.checked)}
                      style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                        <span style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a" }}>Product pages</span>
                        <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontSize: "10.5px", fontWeight: "700", padding: "1px 7px", borderRadius: "10px" }}>
                          Recommended
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                        Badge appears alongside product details and Add to Cart button
                      </div>
                    </div>
                  </div>
                  <span style={{ backgroundColor: "#eff6ff", color: "#2563eb", fontSize: "11px", fontWeight: "700", padding: "3px 8px", borderRadius: "8px", whiteSpace: "nowrap" }}>
                    ↗ Highest impact
                  </span>
                </label>

                {/* Option 2: Individual Product Reviews with Vendor Trust Score */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    backgroundColor: showProductReviews ? "#f8fafc" : "#ffffff",
                    border: `1px solid ${showProductReviews ? "#cbd5e1" : "#e2e8f0"}`,
                    borderRadius: "10px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={showProductReviews}
                      onChange={(e) => setShowProductReviews(e.target.checked)}
                      style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                        <span style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a" }}>Show product reviews with vendor trust score</span>
                        <span style={{ backgroundColor: "#fef3c7", color: "#b45309", fontSize: "10.5px", fontWeight: "700", padding: "1px 7px", borderRadius: "10px" }}>
                          ⭐ 35% Weight
                        </span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                        Display individual product review star rating & review counts alongside the vendor Trust Score
                      </div>
                    </div>
                  </div>
                  <span style={{ backgroundColor: "#fffbeb", color: "#b45309", fontSize: "11px", fontWeight: "700", padding: "3px 8px", borderRadius: "8px", whiteSpace: "nowrap" }}>
                    ⭐ High conversion
                  </span>
                </label>


                {/* Option 4: Cart page */}
                <label
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    backgroundColor: showOnCartPage ? "#f8fafc" : "#ffffff",
                    border: `1px solid ${showOnCartPage ? "#cbd5e1" : "#e2e8f0"}`,
                    borderRadius: "10px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
                    <input
                      type="checkbox"
                      checked={showOnCartPage}
                      onChange={(e) => setShowOnCartPage(e.target.checked)}
                      style={{ marginTop: "3px", width: "16px", height: "16px", accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    <div>
                      <span style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a" }}>Cart page</span>
                      <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
                        Show the badge as a trust signal in the cart drawer before checkout
                      </div>
                    </div>
                  </div>
                  <span style={{ backgroundColor: "#f1f5f9", color: "#64748b", fontSize: "11px", fontWeight: "700", padding: "3px 8px", borderRadius: "8px", whiteSpace: "nowrap" }}>
                    🛒 Reduces abandon
                  </span>
                </label>
              </div>
            </div>

            {/* 2. WIDGET POSITION & COMPACT VIEW (2-Column Row) */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              
              {/* Position Card */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "15px" }}>🪟</span>
                    <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                      Widget Position
                    </h3>
                  </div>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 12px 0" }}>
                    Where on the product page should the badge appear
                  </p>

                  <div ref={positionMenuRef} style={{ position: "relative" }}>
                    <button
                      type="button"
                      onClick={() => setIsPositionMenuOpen(!isPositionMenuOpen)}
                      style={{
                        width: "100%",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        backgroundColor: "#ffffff",
                        border: "1px solid #cbd5e1",
                        borderRadius: "8px",
                        padding: "8px 12px",
                        fontSize: "12.5px",
                        fontWeight: "600",
                        color: "#0f172a",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>{currentPositionObj.icon}</span>
                        <span>{currentPositionObj.label}</span>
                      </span>
                      <span>▾</span>
                    </button>

                    {isPositionMenuOpen && (
                      <div
                        style={{
                          position: "absolute",
                          top: "calc(100% + 4px)",
                          left: 0,
                          right: 0,
                          backgroundColor: "#ffffff",
                          border: "1px solid #e2e8f0",
                          borderRadius: "8px",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                          padding: "4px",
                          zIndex: 50,
                        }}
                      >
                        {positionOptions.map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setBadgePlacement(opt.id);
                              setIsPositionMenuOpen(false);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "7px 10px",
                              fontSize: "12px",
                              fontWeight: badgePlacement === opt.id ? "700" : "500",
                              color: badgePlacement === opt.id ? "#4f46e5" : "#334155",
                              backgroundColor: badgePlacement === opt.id ? "#eef2ff" : "transparent",
                              border: "none",
                              borderRadius: "6px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <span>{opt.icon}</span>
                            <span>{opt.label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: "14px", borderTop: "1px solid #f1f5f9", paddingTop: "10px", fontSize: "11px", color: "#94a3b8" }}>
                  <div style={{ fontWeight: "700", marginBottom: "3px" }}>Available placements</div>
                  <div>• Below Add to Cart (Default)</div>
                  <div>• Above Add to Cart</div>
                  <div>• Below description · Sticky bar</div>
                </div>
              </div>

              {/* Compact View Card */}
              <div
                style={{
                  backgroundColor: "#ffffff",
                  borderRadius: "14px",
                  border: "1px solid #e2e8f0",
                  padding: "18px 20px",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "15px" }}>⤢</span>
                    <h3 style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                      Compact View
                    </h3>
                  </div>
                  <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 14px 0" }}>
                    Show a condensed single-row badge to save vertical space
                  </p>

                  <div
                    style={{
                      border: "1px solid #e2e8f0",
                      borderRadius: "10px",
                      padding: "12px 14px",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      backgroundColor: compactMode ? "#f8fafc" : "#ffffff",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Enable compact mode</div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                        Condenses badge height to a slim horizontal bar
                      </div>
                    </div>
                    <label aria-label="Enable compact mode" className="widget-switch">
                      <input
                        type="checkbox"
                        checked={compactMode}
                        onChange={(e) => setCompactMode(e.target.checked)}
                      />
                      <span className="widget-slider" />
                    </label>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. BADGE STYLE */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "16px" }}>🖌️</span>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                    Badge Style
                  </h3>
                </div>
                <span style={{ fontSize: "11.5px", color: "#64748b", fontWeight: "600" }}>
                  Live Preview updates instantly →
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginTop: "14px" }}>
                
                {/* Style 1: Full */}
                <label
                  style={{
                    border: `2px solid ${badgeStyle === "FULL" ? "#4f46e5" : "#e2e8f0"}`,
                    borderRadius: "12px",
                    padding: "14px",
                    cursor: "pointer",
                    backgroundColor: badgeStyle === "FULL" ? "#faf5ff" : "#ffffff",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "12px",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <input
                      type="radio"
                      name="badgeStyle"
                      checked={badgeStyle === "FULL"}
                      onChange={() => setBadgeStyle("FULL")}
                      style={{ accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    {badgeStyle === "FULL" && (
                      <span style={{ backgroundColor: "#4f46e5", color: "#ffffff", fontSize: "10px", fontWeight: "800", padding: "1px 6px", borderRadius: "8px" }}>
                        Active
                      </span>
                    )}
                  </div>

                  {/* Mini Preview Box */}
                  <div style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ color: "#10b981", fontSize: "14px" }}>🛡️</span>
                      <div>
                        <span style={{ fontSize: "12px", fontWeight: "800" }}>{displayScore}</span>
                        <span style={{ fontSize: "9px", color: "#94a3b8" }}>/100</span>
                      </div>
                      <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontSize: "9px", fontWeight: "700", padding: "1px 4px", borderRadius: "4px" }}>
                        {tierName}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "4px", fontSize: "8.5px", color: "#64748b", marginTop: "4px" }}>
                      <span>⭐ 4.8★</span>
                      <span>📦 {onTimeRate}%</span>
                      <span>⟳ {returnRate}%</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>Full</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>Product review + vendor trust + stats</div>
                  </div>
                </label>

                {/* Style 2: Compact */}
                <label
                  style={{
                    border: `2px solid ${badgeStyle === "COMPACT" ? "#4f46e5" : "#e2e8f0"}`,
                    borderRadius: "12px",
                    padding: "14px",
                    cursor: "pointer",
                    backgroundColor: badgeStyle === "COMPACT" ? "#faf5ff" : "#ffffff",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "12px",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <input
                      type="radio"
                      name="badgeStyle"
                      checked={badgeStyle === "COMPACT"}
                      onChange={() => setBadgeStyle("COMPACT")}
                      style={{ accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    {badgeStyle === "COMPACT" && (
                      <span style={{ backgroundColor: "#4f46e5", color: "#ffffff", fontSize: "10px", fontWeight: "800", padding: "1px 6px", borderRadius: "8px" }}>
                        Active
                      </span>
                    )}
                  </div>

                  {/* Mini Preview Box */}
                  <div style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "9.5px", flexWrap: "wrap" }}>
                      <span style={{ color: "#f59e0b", fontWeight: "700" }}>⭐ 4.8</span>
                      <span style={{ color: "#cbd5e1" }}>•</span>
                      <span style={{ color: "#10b981" }}>🛡️</span>
                      <span style={{ fontWeight: "800" }}>{displayScore}/100</span>
                      <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontWeight: "700", padding: "1px 4px", borderRadius: "4px", fontSize: "8px" }}>
                        {tierName}
                      </span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>Compact</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>Review rating + vendor score in one row</div>
                  </div>
                </label>

                {/* Style 3: Minimal */}
                <label
                  style={{
                    border: `2px solid ${badgeStyle === "MINIMAL" ? "#4f46e5" : "#e2e8f0"}`,
                    borderRadius: "12px",
                    padding: "14px",
                    cursor: "pointer",
                    backgroundColor: badgeStyle === "MINIMAL" ? "#faf5ff" : "#ffffff",
                    transition: "all 0.15s ease",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    gap: "12px",
                    position: "relative",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <input
                      type="radio"
                      name="badgeStyle"
                      checked={badgeStyle === "MINIMAL"}
                      onChange={() => setBadgeStyle("MINIMAL")}
                      style={{ accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    {badgeStyle === "MINIMAL" && (
                      <span style={{ backgroundColor: "#4f46e5", color: "#ffffff", fontSize: "10px", fontWeight: "800", padding: "1px 6px", borderRadius: "8px" }}>
                        Active
                      </span>
                    )}
                  </div>

                  {/* Mini Preview Box */}
                  <div style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "9.5px" }}>
                      <span style={{ color: "#f59e0b", fontWeight: "700" }}>⭐ 4.8★</span>
                      <span style={{ color: "#cbd5e1" }}>•</span>
                      <span style={{ color: "#10b981" }}>🛡️</span>
                      <span style={{ fontWeight: "700" }}>{displayScore}/100</span>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>Minimal</div>
                    <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>Review rating + Trust badge pill</div>
                  </div>
                </label>

              </div>
            </div>

            {/* 4. SCORE VISIBILITY */}
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                padding: "20px 22px",
                boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ fontSize: "16px" }}>#</span>
                <h3 style={{ fontSize: "15px", fontWeight: "700", color: "#0f172a", margin: 0 }}>
                  Score Visibility
                </h3>
              </div>
              <p style={{ fontSize: "12.5px", color: "#64748b", margin: "0 0 14px 0" }}>
                Control whether buyers see your numeric score or just your tier label
              </p>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                
                {/* Option A: Show numeric score */}
                <label
                  style={{
                    border: `2px solid ${showNumericScore ? "#4f46e5" : "#e2e8f0"}`,
                    borderRadius: "10px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    backgroundColor: showNumericScore ? "#faf5ff" : "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="radio"
                      name="scoreVisibility"
                      checked={showNumericScore}
                      onChange={() => setShowNumericScore(true)}
                      style={{ accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Show numeric score</div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>
                        Displays &quot;{displayScore} / 100&quot; — transparent and specific
                      </div>
                    </div>
                  </div>
                  <span style={{ backgroundColor: "#eff6ff", color: "#1e40af", fontWeight: "800", fontSize: "12px", padding: "3px 8px", borderRadius: "6px" }}>
                    {displayScore}/100
                  </span>
                </label>

                {/* Option B: Show tier label only */}
                <label
                  style={{
                    border: `2px solid ${!showNumericScore ? "#4f46e5" : "#e2e8f0"}`,
                    borderRadius: "10px",
                    padding: "12px 14px",
                    cursor: "pointer",
                    backgroundColor: !showNumericScore ? "#faf5ff" : "#ffffff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <input
                      type="radio"
                      name="scoreVisibility"
                      checked={!showNumericScore}
                      onChange={() => setShowNumericScore(false)}
                      style={{ accentColor: "#4f46e5", cursor: "pointer" }}
                    />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>Show tier label only</div>
                      <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>
                        Displays &quot;{tierName}&quot; — cleaner and less intimidating
                      </div>
                    </div>
                  </div>
                  <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontWeight: "800", fontSize: "12px", padding: "3px 8px", borderRadius: "6px" }}>
                    ✓ {tierName}
                  </span>
                </label>

              </div>
            </div>

            {/* 5. BOTTOM ACTIONS BAR */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                backgroundColor: "#ffffff",
                borderRadius: "12px",
                border: "1px solid #e2e8f0",
                padding: "14px 20px",
                boxShadow: "0 2px 4px rgba(0,0,0,0.03)",
              }}
            >
              <div>
                {isDirty ? (
                  <span style={{ backgroundColor: "#fffbeb", color: "#b45309", border: "1px solid #fde68a", fontSize: "11.5px", fontWeight: "700", padding: "3px 10px", borderRadius: "14px" }}>
                    ● Unsaved changes
                  </span>
                ) : (
                  <span style={{ color: "#16a34a", fontSize: "12px", fontWeight: "600", display: "flex", alignItems: "center", gap: "4px" }}>
                    <span>✓</span>
                    <span>All settings saved</span>
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <button
                  type="button"
                  onClick={handleDiscard}
                  disabled={!isDirty || isSaving}
                  style={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: "600",
                    color: isDirty ? "#334155" : "#94a3b8",
                    cursor: isDirty ? "pointer" : "not-allowed",
                    transition: "all 0.15s ease",
                  }}
                >
                  Discard
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!isDirty || isSaving}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    backgroundColor: isDirty ? "#4f46e5" : "#94a3b8",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "8px 18px",
                    fontSize: "13px",
                    fontWeight: "700",
                    cursor: isDirty ? "pointer" : "not-allowed",
                    boxShadow: isDirty ? "0 2px 4px rgba(79, 70, 229, 0.25)" : "none",
                    transition: "all 0.15s ease",
                  }}
                >
                  {isSaving ? (
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
                  ) : (
                    <span>💾</span>
                  )}
                  <span>{isSaving ? "Saving..." : "Save Changes"}</span>
                </button>
              </div>
            </div>

          </div>

          {/* ════════════ RIGHT COLUMN: LIVE STOREFRONT PREVIEW ════════════ */}
          <div style={{ position: "sticky", top: "20px" }}>
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                border: "1px solid #e2e8f0",
                boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
                overflow: "hidden",
              }}
            >
              {/* Preview Top Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "14px 18px",
                  borderBottom: "1px solid #f1f5f9",
                  backgroundColor: "#ffffff",
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: badgeEnabled ? "#16a34a" : "#94a3b8",
                        boxShadow: badgeEnabled ? "0 0 0 3px rgba(22, 163, 74, 0.15)" : "none",
                      }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>Live Preview</span>
                  </div>
                  <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px" }}>
                     {previewTab === "product" ? `Product Page · ${currentPositionObj.label}` : "Cart Page"}
                  </div>
                </div>

                {/* Device Switcher */}
                <div style={{ display: "flex", backgroundColor: "#f1f5f9", borderRadius: "6px", padding: "2px" }}>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("desktop")}
                    style={{
                      padding: "4px 8px",
                      fontSize: "12px",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      backgroundColor: previewDevice === "desktop" ? "#ffffff" : "transparent",
                      color: previewDevice === "desktop" ? "#0f172a" : "#64748b",
                      boxShadow: previewDevice === "desktop" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    💻
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewDevice("mobile")}
                    style={{
                      padding: "4px 8px",
                      fontSize: "12px",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      backgroundColor: previewDevice === "mobile" ? "#ffffff" : "transparent",
                      color: previewDevice === "mobile" ? "#0f172a" : "#64748b",
                      boxShadow: previewDevice === "mobile" ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                    }}
                  >
                    📱
                  </button>
                </div>
              </div>

              {/* Preview Page Tab Switcher */}
              <div style={{ display: "flex", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc" }}>
                <button
                  type="button"
                  onClick={() => setPreviewTab("product")}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontWeight: previewTab === "product" ? "700" : "500",
                    color: previewTab === "product" ? "#4f46e5" : "#64748b",
                    border: "none",
                    borderBottom: previewTab === "product" ? "2px solid #4f46e5" : "2px solid transparent",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                  }}
                >
                  🏷️ Product Page
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewTab("cart")}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    fontSize: "12px",
                    fontWeight: previewTab === "cart" ? "700" : "500",
                    color: previewTab === "cart" ? "#4f46e5" : "#64748b",
                    border: "none",
                    borderBottom: previewTab === "cart" ? "2px solid #4f46e5" : "2px solid transparent",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                  }}
                >
                  🛒 Cart Drawer
                </button>
              </div>

              {/* Mock Browser Container */}
              <div
                style={{
                  backgroundColor: "#f8fafc",
                  padding: previewDevice === "mobile" ? "18px 20px" : "18px",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <div
                  style={{
                    width: previewDevice === "mobile" ? "320px" : "100%",
                    maxWidth: "400px",
                    backgroundColor: "#ffffff",
                    borderRadius: "12px",
                    border: "1px solid #e2e8f0",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.05)",
                    overflow: "hidden",
                  }}
                >
                  {/* Browser URL Bar */}
                  <div
                    style={{
                      backgroundColor: "#f1f5f9",
                      padding: "6px 12px",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      borderBottom: "1px solid #e2e8f0",
                      fontSize: "10.5px",
                      color: "#64748b",
                    }}
                  >
                    <span style={{ color: "#ef4444" }}>●</span>
                    <span style={{ color: "#f59e0b" }}>●</span>
                    <span style={{ color: "#10b981" }}>●</span>
                    <span style={{ marginLeft: "4px" }}>
                      {previewTab === "product"
                        ? "🔒 your-store.com/products/running-shoes"
                        : "🔒 your-store.com/cart"}
                    </span>
                  </div>

                  {/* ── TAB 1: PRODUCT PAGE PREVIEW ── */}
                  {previewTab === "product" && (
                    <div style={{ padding: "16px" }}>
                      {!badgeEnabled ? (
                        <div style={{ padding: "30px 15px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                          <div style={{ fontSize: "24px", marginBottom: "6px" }}>🛡️</div>
                          <div style={{ fontWeight: "700", color: "#0f172a" }}>TrustLayer badge is turned off</div>
                          <div style={{ marginTop: "4px" }}>Turn on &quot;Enable Badge&quot; above to display your badge to shoppers.</div>
                          <button
                            type="button"
                            onClick={() => setBadgeEnabled(true)}
                            style={{
                              marginTop: "12px",
                              backgroundColor: "#2563eb",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "6px",
                              padding: "6px 14px",
                              fontSize: "12px",
                              fontWeight: "600",
                              cursor: "pointer",
                            }}
                          >
                            Enable Badge
                          </button>
                        </div>
                      ) : !showOnProductPages ? (
                        <div style={{ padding: "30px 15px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                          <div style={{ fontSize: "24px", marginBottom: "6px" }}>👁️‍🗨️</div>
                          <div style={{ fontWeight: "700", color: "#0f172a" }}>Badge disabled on product pages</div>
                          <div style={{ marginTop: "4px" }}>Enable &quot;Product pages&quot; in Display Settings to preview.</div>
                        </div>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: "12px", marginBottom: "14px" }}>
                            {/* Product Image */}
                            <div
                              style={{
                                width: "70px",
                                height: "70px",
                                backgroundColor: "#f1f5f9",
                                borderRadius: "8px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "28px",
                                flexShrink: 0,
                              }}
                            >
                              👟
                            </div>

                            {/* Product Info */}
                            <div>
                              <div style={{ fontSize: "14px", fontWeight: "800", color: "#0f172a" }}>Running Shoes Pro</div>
                              <div style={{ display: "flex", alignItems: "center", gap: "5px", margin: "2px 0" }}>
                                {showProductReviews ? (
                                  <>
                                    <span style={{ color: "#f59e0b", fontSize: "12px", fontWeight: "700" }}>★★★★★</span>
                                    <span style={{ fontSize: "11.5px", fontWeight: "700", color: "#0f172a" }}>4.8</span>
                                    <span style={{ fontSize: "10.5px", color: "#64748b" }}>(24 reviews)</span>
                                  </>
                                ) : (
                                  <span style={{ fontSize: "11px", color: "#64748b" }}>New Listing</span>
                                )}
                              </div>
                              <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a" }}>$79.99</div>
                              <div style={{ fontSize: "11px", color: "#64748b", marginTop: "1px" }}>
                                Sold by <strong style={{ color: "#4f46e5" }}>{storeName}</strong>
                              </div>

                              {/* Size options */}
                              <div style={{ display: "flex", gap: "4px", marginTop: "6px" }}>
                                {["8", "9", "10", "11"].map((s) => (
                                  <span
                                    key={s}
                                    style={{
                                      width: "20px",
                                      height: "20px",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "10px",
                                      fontWeight: s === "9" ? "800" : "600",
                                      borderRadius: "4px",
                                      backgroundColor: s === "9" ? "#0f172a" : "#f1f5f9",
                                      color: s === "9" ? "#ffffff" : "#475569",
                                    }}
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>

                          {/* ABOVE ADD TO CART BADGE PLACEMENT */}
                          {badgePlacement === "PRODUCT_PAGE_ABOVE_ATC" && (
                            <div style={{ marginBottom: "12px" }}>
                              <RenderBadgePreview
                                badgeStyle={badgeStyle}
                                compactMode={compactMode}
                                showNumericScore={showNumericScore}
                                displayScore={displayScore}
                                tierName={tierName}
                                storeName={storeName}
                                onTimeRate={onTimeRate}
                                returnRate={returnRate}
                                csatRating={csatRating}
                                showProductReviews={showProductReviews}
                              />
                            </div>
                          )}

                          {/* Add to Cart Button */}
                          <button
                            type="button"
                            style={{
                              width: "100%",
                              backgroundColor: "#0f172a",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "8px",
                              padding: "10px",
                              fontSize: "12.5px",
                              fontWeight: "700",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "6px",
                              cursor: "pointer",
                              marginBottom: "12px",
                            }}
                          >
                            <span>🛒</span>
                            <span>Add to Cart</span>
                          </button>

                          {/* BELOW ADD TO CART BADGE PLACEMENT */}
                          {badgePlacement === "PRODUCT_PAGE_BELOW_ATC" && (
                            <div style={{ marginBottom: "10px" }}>
                              <RenderBadgePreview
                                badgeStyle={badgeStyle}
                                compactMode={compactMode}
                                showNumericScore={showNumericScore}
                                displayScore={displayScore}
                                tierName={tierName}
                                storeName={storeName}
                                onTimeRate={onTimeRate}
                                returnRate={returnRate}
                                csatRating={csatRating}
                                showProductReviews={showProductReviews}
                              />
                            </div>
                          )}

                          {/* Product Description */}
                          <div style={{ fontSize: "11px", color: "#64748b", lineHeight: "1.4", borderTop: "1px solid #f1f5f9", paddingTop: "10px" }}>
                            Breathable mesh running shoes with responsive foam cushioning for everyday performance and comfort.
                          </div>

                          {/* BELOW DESCRIPTION BADGE PLACEMENT */}
                          {badgePlacement === "PRODUCT_PAGE_BELOW_DESC" && (
                            <div style={{ marginTop: "12px" }}>
                              <RenderBadgePreview
                                badgeStyle={badgeStyle}
                                compactMode={compactMode}
                                showNumericScore={showNumericScore}
                                displayScore={displayScore}
                                tierName={tierName}
                                storeName={storeName}
                                onTimeRate={onTimeRate}
                                returnRate={returnRate}
                                csatRating={csatRating}
                                showProductReviews={showProductReviews}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* STICKY BOTTOM BAR PLACEMENT */}
                  {previewTab === "product" && showOnProductPages && badgePlacement === "PRODUCT_PAGE_STICKY_BOTTOM" && (
                    <div style={{ backgroundColor: "#0f172a", color: "#ffffff", padding: "8px 12px", borderTop: "1px solid #334155" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                          <span>🛡️</span>
                          <span style={{ fontWeight: "700" }}>{showNumericScore ? `${displayScore}/100 Vendor Trust` : `${tierName} Vendor`}</span>
                        </div>
                        <span style={{ color: "#94a3b8", fontSize: "10px" }}>TrustLayer Verified</span>
                      </div>
                    </div>
                  )}


                  {/* ── TAB 3: CART DRAWER PREVIEW ── */}
                  {previewTab === "cart" && (
                    <div style={{ padding: "16px" }}>
                      {!badgeEnabled ? (
                        <div style={{ padding: "30px 15px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                          <div style={{ fontSize: "24px", marginBottom: "6px" }}>🛡️</div>
                          <div style={{ fontWeight: "700", color: "#0f172a" }}>TrustLayer badge is turned off</div>
                          <div style={{ marginTop: "4px" }}>Turn on &quot;Enable Badge&quot; above to display the badge in cart.</div>
                        </div>
                      ) : !showOnCartPage ? (
                        <div style={{ padding: "30px 15px", textAlign: "center", color: "#64748b", fontSize: "12px" }}>
                          <div style={{ fontSize: "24px", marginBottom: "6px" }}>🛒</div>
                          <div style={{ fontWeight: "700", color: "#0f172a" }}>Trust badge disabled in cart</div>
                          <div style={{ marginTop: "4px" }}>Enable &quot;Cart page&quot; in Display Settings to show this reassurance signal.</div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", borderBottom: "1px solid #f1f5f9", paddingBottom: "8px" }}>
                            <div style={{ fontWeight: "800", fontSize: "14px", color: "#0f172a" }}>Your Cart (1 item)</div>
                            <span style={{ fontSize: "12px", color: "#64748b" }}>✕</span>
                          </div>

                          <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "14px" }}>
                            <div style={{ width: "45px", height: "45px", backgroundColor: "#f1f5f9", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                              👟
                            </div>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: "12px", fontWeight: "700", color: "#0f172a" }}>Running Shoes Pro</div>
                              <div style={{ fontSize: "11px", color: "#64748b" }}>Qty: 1 · Size: 9</div>
                            </div>
                            <div style={{ fontSize: "12.5px", fontWeight: "800", color: "#0f172a" }}>$79.99</div>
                          </div>

                          {/* CART TRUST BADGE BANNER */}
                          <div style={{ backgroundColor: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "8px", padding: "8px 10px", marginBottom: "14px", display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "16px" }}>🛡️</span>
                            <div style={{ fontSize: "11px" }}>
                              <strong style={{ color: "#1e40af" }}>TrustLayer Protected:</strong> {storeName} is a verified seller with {onTimeRate}% on-time delivery.
                            </div>
                          </div>

                          <button
                            type="button"
                            style={{
                              width: "100%",
                              backgroundColor: "#0f172a",
                              color: "#ffffff",
                              border: "none",
                              borderRadius: "8px",
                              padding: "10px",
                              fontSize: "12.5px",
                              fontWeight: "700",
                              cursor: "pointer",
                            }}
                          >
                            Checkout • $79.99
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>

              {/* Preview Footer Tag Line */}
              <div
                style={{
                  padding: "12px 18px",
                  borderTop: "1px solid #f1f5f9",
                  backgroundColor: "#ffffff",
                  fontSize: "11.5px",
                  color: "#64748b",
                }}
              >
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "4px" }}>
                  <span style={{ backgroundColor: "#eff6ff", color: "#2563eb", padding: "2px 8px", borderRadius: "10px", fontWeight: "700" }}>
                    ● {badgeStyle === "FULL" ? "Full style" : badgeStyle === "COMPACT" ? "Compact style" : "Minimal style"}
                  </span>
                  <span style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                    {currentPositionObj.label}
                  </span>
                  <span style={{ backgroundColor: "#f1f5f9", color: "#475569", padding: "2px 8px", borderRadius: "10px", fontWeight: "600" }}>
                    {showNumericScore ? "# Numeric score" : "✓ Tier label"}
                  </span>
                </div>
                <div>ⓘ Changes reflect immediately in this preview — click Save Changes to publish</div>
              </div>

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}

// ── Live Badge Renderer Component ──
function RenderBadgePreview({
  badgeStyle,
  compactMode,
  showNumericScore,
  displayScore,
  tierName,
  storeName,
  onTimeRate,
  returnRate,
  csatRating,
  showProductReviews = true,
}: {
  badgeStyle: "FULL" | "COMPACT" | "MINIMAL";
  compactMode: boolean;
  showNumericScore: boolean;
  displayScore: number;
  tierName: string;
  storeName: string;
  onTimeRate: number;
  returnRate: number;
  csatRating: number;
  showProductReviews?: boolean;
}) {
  if (badgeStyle === "MINIMAL") {
    return (
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "8px 12px",
          backgroundColor: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "11px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {showProductReviews && (
            <>
              <span style={{ color: "#f59e0b", fontWeight: "700" }}>⭐ 4.8</span>
              <span style={{ color: "#cbd5e1" }}>•</span>
            </>
          )}
          <span style={{ color: "#10b981", fontSize: "13px" }}>🛡️</span>
          <span style={{ fontWeight: "700", color: "#0f172a" }}>
            {showNumericScore ? `${displayScore}/100 Vendor Trust` : `${tierName} Vendor`}
          </span>
        </div>
        <span style={{ color: "#94a3b8", fontSize: "10px" }}>Verified</span>
      </div>
    );
  }

  if (badgeStyle === "COMPACT" || compactMode) {
    return (
      <div
        style={{
          border: "1px solid #e2e8f0",
          borderRadius: "8px",
          padding: "8px 12px",
          backgroundColor: "#ffffff",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          {showProductReviews && (
            <div style={{ display: "flex", alignItems: "center", gap: "3px", marginRight: "4px" }}>
              <span style={{ color: "#f59e0b", fontSize: "11px" }}>⭐</span>
              <span style={{ fontSize: "11px", fontWeight: "800", color: "#0f172a" }}>4.8</span>
              <span style={{ fontSize: "10px", color: "#64748b" }}>(24)</span>
              <span style={{ color: "#cbd5e1", marginLeft: "2px" }}>•</span>
            </div>
          )}
          <span style={{ color: "#10b981", fontSize: "14px" }}>🛡️</span>
          {showNumericScore && (
            <span style={{ fontSize: "13px", fontWeight: "800", color: "#0f172a" }}>
              {displayScore}<span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: "600" }}>/100</span>
            </span>
          )}
          <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontSize: "10.5px", fontWeight: "700", padding: "1px 6px", borderRadius: "4px" }}>
            {tierName}
          </span>
          <span style={{ fontSize: "11px", color: "#64748b" }}> by - {storeName.split(" ")[0]}</span>
        </div>
        <span style={{ color: "#2563eb", fontSize: "10px", fontWeight: "700", display: "flex", alignItems: "center", gap: "3px", flexShrink: 0 }}>
          🛡️ TrustLayer
        </span>
      </div>
    );
  }

  // Full Style
  return (
    <div
      style={{
        border: "1px solid #e2e8f0",
        borderRadius: "10px",
        padding: "12px 14px",
        backgroundColor: "#ffffff",
        boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
        position: "relative",
      }}
    >
      {/* Top Shield & Score Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              backgroundColor: "#ecfdf5",
              color: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
            }}
          >
            🛡️
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "3px" }}>
              {showNumericScore && (
                <>
                  <span style={{ fontSize: "15px", fontWeight: "800", color: "#0f172a" }}>{displayScore}</span>
                  <span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: "700" }}>/100</span>
                  <span style={{ fontSize: "11px", color: "#64748b", fontWeight: "600", marginLeft: "3px" }}>Vendor Trust</span>
                </>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "1px" }}>
              <span style={{ backgroundColor: "#ecfdf5", color: "#059669", fontSize: "9.5px", fontWeight: "700", padding: "1px 5px", borderRadius: "4px" }}>
                {tierName}
              </span>
              <span style={{ fontSize: "10px", color: "#64748b" }}>by <strong style={{ color: "#0f172a" }}>{storeName}</strong></span>
            </div>
          </div>
        </div>

        <span style={{ backgroundColor: "#eff6ff", color: "#2563eb", fontSize: "9.5px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px" }}>
          🛡️ TrustLayer
        </span>
      </div>

      {/* Metric Breakdown Rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: "5px", fontSize: "10.5px", borderTop: "1px solid #f8fafc", paddingTop: "8px" }}>
        {showProductReviews ? (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#64748b" }}>⭐ Product reviews (Item)</span>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ fontWeight: "700", color: "#0f172a" }}>4.8 ★ (24 reviews)</span>
              <div style={{ width: "35px", height: "3px", backgroundColor: "#f1f5f9", borderRadius: "2px" }}>
                <div style={{ width: "96%", height: "100%", backgroundColor: "#f59e0b", borderRadius: "2px" }} />
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#64748b" }}>⭐ Customer satisfaction</span>
            <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              <span style={{ fontWeight: "700", color: "#0f172a" }}>{csatRating}%</span>
              <div style={{ width: "35px", height: "3px", backgroundColor: "#f1f5f9", borderRadius: "2px" }}>
                <div style={{ width: `${Math.min(100, csatRating)}%`, height: "100%", backgroundColor: "#10b981", borderRadius: "2px" }} />
              </div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#64748b" }}>📦 Vendor on-time shipping</span>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ fontWeight: "700", color: "#0f172a" }}>{onTimeRate}%</span>
            <div style={{ width: "35px", height: "3px", backgroundColor: "#f1f5f9", borderRadius: "2px" }}>
              <div style={{ width: `${Math.min(100, onTimeRate)}%`, height: "100%", backgroundColor: "#10b981", borderRadius: "2px" }} />
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#64748b" }}>⟳ Vendor return rate</span>
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
            <span style={{ fontWeight: "700", color: "#0f172a" }}>{returnRate}%</span>
            <div style={{ width: "35px", height: "3px", backgroundColor: "#f1f5f9", borderRadius: "2px" }}>
              <div style={{ width: `${Math.min(100, returnRate * 15)}%`, height: "100%", backgroundColor: "#10b981", borderRadius: "2px" }} />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "1px solid #f1f5f9", marginTop: "8px", paddingTop: "6px", fontSize: "9.5px", color: "#94a3b8" }}>
        <span>Verified supplier & listing</span>
        <span style={{ color: "#059669", fontWeight: "700" }}>🛡️ Shop with confidence</span>
      </div>
    </div>
  );
}
