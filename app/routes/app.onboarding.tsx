import { useState, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs, HeadersFunction } from "react-router";
import { redirect, useLoaderData, useNavigate, useFetcher } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { fetchAndSyncStoreDetails } from "../lib/storeMetrics.server";
import { collectAllVendorsData } from "../lib/vendorCollector.server";
import {
  Star,
  Package,
  RotateCcw,
  AlertTriangle,
  Clock,
  Lock,
} from "lucide-react";

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // 1. Check if user already exists in DB and onboarding is completed
  const existingSettings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  // If already onboarded, redirect straight to the Overview dashboard (/app)
  if (existingSettings && existingSettings.onboardingCompleted) {
    const url = new URL(request.url);
    return redirect(`/app${url.search}`);
  }

  const settings = existingSettings || (await fetchAndSyncStoreDetails(admin, shop));

  return {
    shop,
    settings,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  const intent = formData.get("intent");
  const step = parseInt(formData.get("step") as string, 10) || 1;
  const badgeEnabled = formData.get("badgeEnabled") === "true";
  const badgePlacement = (formData.get("badgePlacement") as string) || "PRODUCT_PAGE_BELOW_ATC";

  if (intent === "connect_store") {
    // 1. Fetch live shop details from Shopify GraphQL
    const updatedSettings = await fetchAndSyncStoreDetails(admin, session.shop);
    // 2. Fetch live products, orders, fulfillments partitioned by vendor
    const vendorResult = await collectAllVendorsData(admin, session.shop);

    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: { onboardingStep: 3 },
      create: { shop: session.shop, onboardingStep: 3 },
    });

    return {
      success: true,
      connected: true,
      settings: updatedSettings,
      summary: vendorResult.summary,
      suppliersCount: vendorResult.suppliers.length,
      step: 3,
    };
  }

  if (intent === "finish") {
    await prisma.appSettings.upsert({
      where: { shop: session.shop },
      update: {
        onboardingStep: 5,
        onboardingCompleted: true,
        badgeEnabled,
        badgePlacement,
      },
      create: {
        shop: session.shop,
        onboardingStep: 5,
        onboardingCompleted: true,
        badgeEnabled,
        badgePlacement,
      },
    });

    return { success: true, completed: true };
  }

  await prisma.appSettings.upsert({
    where: { shop: session.shop },
    update: { onboardingStep: step },
    create: { shop: session.shop, onboardingStep: step },
  });

  return { success: true, step };
};

// const PLACEMENT_OPTIONS = [
//   {
//     id: "PRODUCT_PAGE_BELOW_ATC",
//     label: "Product page (Below Add to Cart)",
//     shortLabel: "Product Page",
//     tag: "Recommended",
//     tagType: "recommended",
//     description: "Placed directly below the Add to Cart button for maximum conversion impact.",
//     icon: (
//       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//         <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
//         <line x1="3" y1="6" x2="21" y2="6"></line>
//         <path d="M16 10a4 4 0 0 1-8 0"></path>
//       </svg>
//     ),
//   },
//   {
//     id: "CART_PAGE",
//     label: "Cart & slide-out drawer",
//     shortLabel: "Cart Drawer",
//     tag: "High Trust",
//     tagType: "popular",
//     description: "Displayed beside checkout CTA to reassure customers and reduce drop-offs.",
//     icon: (
//       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//         <circle cx="9" cy="21" r="1"></circle>
//         <circle cx="20" cy="21" r="1"></circle>
//         <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
//       </svg>
//     ),
//   },
//   {
//     id: "SELLER_PROFILE",
//     label: "Seller profile & store footer",
//     shortLabel: "Store Footer",
//     tag: "Brand Trust",
//     tagType: "info",
//     description: "Featured in dedicated merchant trust credentials section and global footer.",
//     icon: (
//       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//         <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
//         <path d="M9 12l2 2 4-4"></path>
//       </svg>
//     ),
//   },
//   {
//     id: "ALL_PAGES",
//     label: "Floating badge (All pages)",
//     shortLabel: "Floating Widget",
//     tag: "Storewide",
//     tagType: "info",
//     description: "Subtle floating widget docked in the bottom corner storewide.",
//     icon: (
//       <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
//         <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
//         <line x1="3" y1="9" x2="21" y2="9"></line>
//         <line x1="9" y1="21" x2="9" y2="9"></line>
//       </svg>
//     ),
//   },
// ];

export default function OnboardingWizard() {
  const { settings: initialSettings } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const navigate = useNavigate();

  const settings = (fetcher.data as { settings?: typeof initialSettings })?.settings || initialSettings;
  const [step, setStep] = useState<number>(settings.onboardingStep || 1);

  useEffect(() => {
    const data = fetcher.data as { connected?: boolean; step?: number } | undefined;
    if (data?.connected && data?.step) {
      setStep(data.step);
    }
  }, [fetcher.data]);

  const [isCompletedScreen, setIsCompletedScreen] = useState<boolean>(false);
  const [badgeEnabled, setBadgeEnabled] = useState<boolean>(settings.badgeEnabled ?? true);
  const [badgePlacement] = useState<string>(settings.badgePlacement || "PRODUCT_PAGE_BELOW_ATC");

  const isSubmitting = fetcher.state !== "idle";
  const isConnecting = isSubmitting && fetcher.formData?.get("intent") === "connect_store";

  const handleConnectStore = () => {
    fetcher.submit({ intent: "connect_store" }, { method: "POST" });
  };

  const nextStep = () => {
    if (step < 5) {
      const next = step + 1;
      setStep(next);
      fetcher.submit({ step: next.toString() }, { method: "POST" });
    }
  };

  const prevStep = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const handleFinish = () => {
    fetcher.submit(
      {
        intent: "finish",
        badgeEnabled: badgeEnabled ? "true" : "false",
        badgePlacement,
      },
      { method: "POST" }
    );
    setIsCompletedScreen(true);
  };

  const goToDashboard = () => {
    navigate("/app");
  };

  // Eligibility Progress
  const completedOrders = settings.completedOrdersCount || 12;
  const targetOrders = 20;
  const ordersPercent = Math.min(100, Math.round((completedOrders / targetOrders) * 100));

  const storeAgeDays = settings.storeAgeDays || 18;
  const targetAgeDays = 30;
  const agePercent = Math.min(100, Math.round((storeAgeDays / targetAgeDays) * 100));

  return (
    <div
      style={{
        backgroundColor: "#f1f1f1",
        minHeight: "100vh",
        padding: "20px 16px 32px 16px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#0f172a",
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.85; transform: scale(1.02); }
        }
        @keyframes bounceDot {
          0%, 80%, 100% { transform: scale(0); opacity: 0.3; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes progressIndeterminate {
          0% { width: 5%; transform: translateX(0); }
          50% { width: 60%; transform: translateX(40%); }
          100% { width: 95%; transform: translateX(5%); }
        }
        @keyframes successPop {
          0% { transform: scale(0.2); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          80% { transform: scale(0.95); }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes rippleWave {
          0% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.65); }
          70% { transform: scale(1); box-shadow: 0 0 0 22px rgba(22, 163, 74, 0); }
          100% { transform: scale(0.9); box-shadow: 0 0 0 0 rgba(22, 163, 74, 0); }
        }
        @keyframes confettiFloat1 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(-22px, -18px) rotate(60deg) scale(1.2); }
          60% { transform: translate(-32px, 8px) rotate(190deg) scale(1); }
          100% { transform: translate(-24px, 22px) rotate(360deg) scale(0.9); opacity: 0.9; }
        }
        @keyframes confettiFloat2 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(24px, -22px) rotate(-70deg) scale(1.25); }
          60% { transform: translate(36px, 6px) rotate(140deg) scale(1); }
          100% { transform: translate(28px, 24px) rotate(290deg) scale(0.9); opacity: 0.9; }
        }
        @keyframes confettiFloat3 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(-10px, -32px) rotate(100deg) scale(1.2); }
          60% { transform: translate(-18px, -12px) rotate(220deg) scale(1); }
          100% { transform: translate(-8px, 10px) rotate(360deg) scale(0.95); opacity: 0.9; }
        }
        @keyframes confettiFloat4 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(14px, -30px) rotate(-50deg) scale(1.2); }
          60% { transform: translate(22px, -8px) rotate(-200deg) scale(1); }
          100% { transform: translate(12px, 14px) rotate(-360deg) scale(0.9); opacity: 0.9; }
        }
        @keyframes confettiFloat5 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(-34px, -4px) rotate(120deg) scale(1.15); }
          60% { transform: translate(-42px, 16px) rotate(240deg) scale(1); }
          100% { transform: translate(-36px, 28px) rotate(360deg) scale(0.85); opacity: 0.85; }
        }
        @keyframes confettiFloat6 {
          0% { transform: translate(0, 0) rotate(0deg) scale(0); opacity: 0; }
          25% { opacity: 1; transform: translate(36px, -2px) rotate(-110deg) scale(1.15); }
          60% { transform: translate(44px, 18px) rotate(-230deg) scale(1); }
          100% { transform: translate(38px, 30px) rotate(-360deg) scale(0.85); opacity: 0.85; }
        }
        @keyframes checkmarkDraw {
          0% { transform: scale(0.4) rotate(-20deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(5deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg); opacity: 1; }
        }
        @keyframes slideUpFadeIn {
          0% { opacity: 0; transform: translateY(18px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <div
        style={{
          width: "100%",
          maxWidth: "540px",
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.02)",
          border: "1px solid #e2e8f0",
          padding: "24px 28px",
          display: "flex",
          flexDirection: "column",
          boxSizing: "border-box",
          marginTop: "12px",
          textAlign: isCompletedScreen ? "center" : "left",
        }}
      >
                {/* ── SCREEN 6: YOU'RE ALL SET! (Success Screen with Rich Animations) ── */}
        {isCompletedScreen ? (
          <div style={{ animation: "slideUpFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards" }}>
            {/* Animated Green Checkmark Icon with Bursting Confetti Particles */}
            <div style={{ position: "relative", width: "120px", height: "96px", margin: "0 auto 16px auto" }}>
              {/* Confetti Particles with Individual Dynamic Float Animations */}
              <div style={{ position: "absolute", top: "14px", left: "14px", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#9333ea", animation: "confettiFloat1 2.8s ease-in-out infinite" }}></div>
              <div style={{ position: "absolute", top: "4px", left: "36px", width: "7px", height: "7px", borderRadius: "2px", backgroundColor: "#0284c7", animation: "confettiFloat3 3.2s ease-in-out 0.2s infinite" }}></div>
              <div style={{ position: "absolute", top: "32px", left: "20px", width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#f59e0b", animation: "confettiFloat5 2.6s ease-in-out 0.4s infinite" }}></div>
              <div style={{ position: "absolute", top: "6px", right: "28px", width: "7px", height: "7px", borderRadius: "2px", backgroundColor: "#f59e0b", animation: "confettiFloat4 3s ease-in-out 0.1s infinite" }}></div>
              <div style={{ position: "absolute", top: "18px", right: "10px", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#06b6d4", animation: "confettiFloat2 2.9s ease-in-out 0.3s infinite" }}></div>
              <div style={{ position: "absolute", top: "36px", right: "22px", width: "7px", height: "7px", borderRadius: "50%", backgroundColor: "#ef4444", animation: "confettiFloat6 2.7s ease-in-out 0.5s infinite" }}></div>

              {/* Pulsing & Spring-Pop Green Badge Circle */}
              <div
                style={{
                  width: "68px",
                  height: "68px",
                  borderRadius: "50%",
                  backgroundColor: "#16a34a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "12px auto 0 auto",
                  boxShadow: "0 8px 20px rgba(22, 163, 74, 0.3)",
                  animation: "successPop 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards, rippleWave 2.4s ease-out 0.6s infinite",
                }}
              >
                <svg
                  width="34"
                  height="34"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  style={{ animation: "checkmarkDraw 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both" }}
                >
                  <path d="M5 13L9.5 17.5L19 7" stroke="white" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>

            {/* Title & Subtitle */}
            <h1
              style={{
                fontSize: "26px",
                fontWeight: "800",
                color: "#0f172a",
                margin: "0 0 10px 0",
                letterSpacing: "-0.02em",
                animation: "slideUpFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both",
              }}
            >
              {"You're all set! 🎉"}
            </h1>
            <p
              style={{
                fontSize: "13.5px",
                color: "#475569",
                lineHeight: "1.6",
                maxWidth: "420px",
                margin: "0 auto 24px auto",
                animation: "slideUpFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both",
              }}
            >
              TrustLayer is now actively analyzing your store performance. Once you meet the minimum eligibility milestones, your live verified score and trust badge will display automatically on your storefront.
            </p>

            {/* What's Next Card */}
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: "14px",
                padding: "18px 20px",
                backgroundColor: "#ffffff",
                textAlign: "left",
                marginBottom: "28px",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.02)",
                animation: "slideUpFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.35s both",
              }}
            >
              <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a", marginBottom: "12px" }}>
                {"What's next?"}
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={goToDashboard}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") goToDashboard();
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  cursor: "pointer",
                  padding: "8px 6px",
                  borderRadius: "10px",
                  transition: "background-color 0.15s ease",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <div
                    style={{
                      width: "46px",
                      height: "46px",
                      borderRadius: "12px",
                      backgroundColor: "#eff6ff",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="20" x2="18" y2="10"></line>
                      <line x1="12" y1="20" x2="12" y2="4"></line>
                      <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                  </div>
                  <div>
                    <div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0f172a" }}>Go to your dashboard</div>
                    <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>Track your real-time performance and improve your score.</div>
                  </div>
                </div>

                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: "#f8fafc",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </div>
              </div>
            </div>

            {/* Outlined Blue Go to Dashboard Button */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                animation: "slideUpFadeIn 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.45s both",
              }}
            >
              <button
                onClick={goToDashboard}
                style={{
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "10px",
                  padding: "13px 36px",
                  fontSize: "14.5px",
                  fontWeight: "700",
                  cursor: "pointer",
                  boxShadow: "0 4px 12px rgba(37, 99, 235, 0.25)",
                  transition: "all 0.15s ease",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <span>Go to Dashboard</span>
                <span style={{ fontSize: "16px" }}>→</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Top Bar (Logo / Back & Step Counter) ── */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "18px" }}>
              {step === 1 ? (
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M12 2L4 5V11C4 16.55 7.42 21.74 12 23C16.58 21.74 20 16.55 20 11V5L12 2Z" fill="#2563eb" />
                    <path d="M9 11.5L11 13.5L15.5 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span style={{ fontWeight: "800", fontSize: "20px", color: "#0f172a", letterSpacing: "-0.02em" }}>
                    TrustLayer
                  </span>
                </div>
              ) : (
                <button
                  onClick={prevStep}
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: "#0f172a",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: 0,
                  }}
                >
                  <span style={{ fontSize: "16px" }}>←</span>
                  <span>Back</span>
                </button>
              )}

              <div
                style={{
                  backgroundColor: "#f8fafc",
                  color: "#475569",
                  border: "1px solid #e2e8f0",
                  padding: "5px 12px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: "600",
                  letterSpacing: "-0.01em",
                }}
              >
                Step {step} of 5
              </div>
            </div>

            {/* ── STEP 1: Welcome to TrustLayer ── */}
            {step === 1 && (
              <div>
                <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "20px", alignItems: "center", marginBottom: "28px" }}>
                  <div>
                    <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 12px 0", letterSpacing: "-0.02em" }}>
                      Welcome to TrustLayer
                    </h1>
                    <p style={{ fontSize: "14px", fontWeight: "700", color: "#1e293b", margin: "0 0 8px 0", lineHeight: "1.4" }}>
                      Build trust. Increase conversions. Grow your business.
                    </p>
                    <p style={{ fontSize: "13px", color: "#475569", lineHeight: "1.5", margin: 0 }}>
                      TrustLayer analyzes your store performance and shows a trust score badge to your customers.
                    </p>
                  </div>

                  <div style={{ position: "relative", width: "100%", height: "160px" }}>
                    <div
                      style={{
                        width: "100%",
                        height: "140px",
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.04)",
                        overflow: "hidden",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: "1px solid #f1f5f9", backgroundColor: "#fafbfc" }}>
                        <div style={{ display: "flex", gap: "4px" }}>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#cbd5e1" }}></div>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#cbd5e1" }}></div>
                          <div style={{ width: "6px", height: "6px", borderRadius: "50%", backgroundColor: "#cbd5e1" }}></div>
                        </div>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="9" cy="21" r="1"></circle>
                          <circle cx="20" cy="21" r="1"></circle>
                          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                      </div>

                      <div style={{ padding: "10px", display: "flex", gap: "10px", alignItems: "center" }}>
                        <div
                          style={{
                            width: "60px",
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
                          🪴
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ width: "60px", height: "7px", backgroundColor: "#e2e8f0", borderRadius: "4px", marginBottom: "6px" }}></div>
                          <div style={{ width: "40px", height: "7px", backgroundColor: "#f1f5f9", borderRadius: "4px" }}></div>
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        position: "absolute",
                        right: "-8px",
                        bottom: "2px",
                        backgroundColor: "#ffffff",
                        border: "1px solid #e2e8f0",
                        borderRadius: "10px",
                        padding: "10px 14px",
                        boxShadow: "0 10px 20px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                        zIndex: 10,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div
                          style={{
                            width: "28px",
                            height: "28px",
                            borderRadius: "6px",
                            backgroundColor: "#eff6ff",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 2L4 5V11C4 16.55 7.42 21.74 12 23C16.58 21.74 20 16.55 20 11V5L12 2Z" fill="#2563eb" />
                            <path d="M9 11.5L11 13.5L15.5 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                        <div>
                          <div style={{ fontSize: "16px", fontWeight: "900", color: "#0f172a", lineHeight: 1 }}>
                            87 <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: "600" }}>/100</span>
                          </div>
                          <div style={{ fontSize: "9px", color: "#64748b", fontWeight: "600", marginTop: "2px" }}>Trust Score</div>
                        </div>
                      </div>
                      <div style={{ color: "#16a34a", fontSize: "12px", letterSpacing: "2px", fontWeight: "bold" }}>
                        ★★★★★
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "32px", borderTop: "1px solid #f1f5f9", paddingTop: "20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                    </svg>
                    <span style={{ fontSize: "13.5px", fontWeight: "500", color: "#1e293b" }}>Standardized trust score based on real data</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                      <path d="M9 12l2 2 4-4"></path>
                    </svg>
                    <span style={{ fontSize: "13.5px", fontWeight: "500", color: "#1e293b" }}>Encourage more purchases and repeat customers</span>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    <span style={{ fontSize: "13.5px", fontWeight: "500", color: "#1e293b" }}>Secure, private and Shopify-compliant</span>
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "end", alignItems:"flex-end", borderTop: "1px solid #f1f5f9", paddingTop: "18px" }}>
                  <button
                    onClick={nextStep}
                    style={{
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px 28px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                    }}
                  >
                    Get Started
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 2: Connect your store ── */}
            {step === 2 && (
              <div>
                <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 10px 0", letterSpacing: "-0.02em" }}>
                  Connect your store
                </h1>
                <p style={{ fontSize: "13.5px", color: "#475569", margin: "0 0 24px 0", lineHeight: "1.5" }}>
                  Grant access to your store data so we can analyze your performance securely.
                </p>

                <div
                  style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: "12px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    marginBottom: "24px",
                    backgroundColor: "#ffffff",
                  }}
                >
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "10px",
                      backgroundColor: "#ecfdf5",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                  <img src="/shopify.png" alt="Shopify logo" width="30" height="34" />
                  </div>
                  <div>
                    <div style={{ fontWeight: "800", fontSize: "16px", color: "#0f172a", marginBottom: "2px" }}>
                      {settings.storeName || "My Store"}
                    </div>
                    <div style={{ fontSize: "13px", color: "#64748b" }}>
                      {settings.myshopifyDomain || settings.shop}
                    </div>
                  </div>
                </div>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "20px", marginBottom: "20px" }}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "#0f172a", marginBottom: "14px" }}>
                    This allows TrustLayer to:
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px", color: "#334155" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" fill="#ecfdf5" stroke="#10b981" strokeWidth="2"/>
                        <path d="M8 12.5L10.5 15L16 9.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>Read orders, returns and fulfillment data</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" fill="#ecfdf5" stroke="#10b981" strokeWidth="2"/>
                        <path d="M8 12.5L10.5 15L16 9.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>Access reviews and dispute information</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" fill="#ecfdf5" stroke="#10b981" strokeWidth="2"/>
                        <path d="M8 12.5L10.5 15L16 9.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>Analyze store performance</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="12" cy="12" r="10" fill="#ecfdf5" stroke="#10b981" strokeWidth="2"/>
                        <path d="M8 12.5L10.5 15L16 9.5" stroke="#10b981" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span>Show your trust score on your storefront</span>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8faff",
                    border: "1px solid #dbeafe",
                    borderRadius: "10px",
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "12.5px",
                    color: "#1e40af",
                    marginBottom: "28px",
                    lineHeight: "1.4",
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                  <div>
                    <div>We only read data and never make changes to your store.</div>
                    <div style={{ fontWeight: "600", marginTop: "2px" }}>Your data is safe and encrypted.</div>
                  </div>
                </div>

                                {/* Active connecting loader progress card */}
                {isConnecting && (
                  <div
                    style={{
                      backgroundColor: "#eff6ff",
                      border: "1px solid #bfdbfe",
                      borderRadius: "12px",
                      padding: "16px 18px",
                      marginBottom: "16px",
                      animation: "slideUpFadeIn 0.3s ease-out forwards",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", fontWeight: "700", color: "#1e40af" }}>
                        <div
                          style={{
                            width: "14px",
                            height: "14px",
                            borderRadius: "50%",
                            border: "2.5px solid #2563eb",
                            borderTopColor: "transparent",
                            animation: "spin 0.8s linear infinite",
                          }}
                        />
                        <span>Syncing store data from Shopify...</span>
                      </div>
                      <span style={{ fontSize: "11px", fontWeight: "600", color: "#3b82f6" }}>Live Sync</span>
                    </div>

                    {/* Progress track */}
                    <div style={{ width: "100%", height: "6px", backgroundColor: "#dbeafe", borderRadius: "3px", overflow: "hidden", position: "relative" }}>
                      <div
                        style={{
                          height: "100%",
                          backgroundColor: "#2563eb",
                          borderRadius: "3px",
                          animation: "progressIndeterminate 1.8s ease-in-out infinite",
                        }}
                      />
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: "10px", fontSize: "11.5px", color: "#475569" }}>
                      <span>✓ Store details & credentials</span>
                      <span>● Products & Order history</span>
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleConnectStore}
                  disabled={isConnecting}
                  style={{
                    width: "100%",
                    backgroundColor: isConnecting ? "#93c5fd" : "#2563eb",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "10px",
                    padding: "14px",
                    fontSize: "15px",
                    fontWeight: "600",
                    cursor: isConnecting ? "not-allowed" : "pointer",
                    boxShadow: isConnecting ? "none" : "0 2px 6px rgba(37, 99, 235, 0.25)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "10px",
                    transition: "all 0.15s ease",
                  }}
                >
                  {isConnecting ? (
                    <>
                      <div
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          border: "2.5px solid #ffffff",
                          borderTopColor: "transparent",
                          animation: "spin 0.8s linear infinite",
                        }}
                      />
                      <span>Connecting & Importing Store Data...</span>
                    </>
                  ) : (
                    <>
                      <span>Connect to Shopify Store</span>
                      <span style={{ fontSize: "16px" }}>→</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* ── STEP 3: Review your Trust Score ── */}
            {step === 3 && (
              <div>
                <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 10px 0", letterSpacing: "-0.02em" }}>
                  Review your Trust Score
                </h1>
                <p style={{ fontSize: "13.5px", color: "#475569", margin: "0 0 24px 0", lineHeight: "1.5" }}>
                  TrustLayer calculates your score using a standardized 5-pillar algorithm to ensure fairness and consistency.
                </p>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "20px 22px", marginBottom: "16px", backgroundColor: "#ffffff" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <div style={{ fontSize: "13px", fontWeight: "700", color: "#0f172a" }}>
                      Score components <span style={{ color: "#64748b", fontWeight: "400" }}>(Fixed by TrustLayer)</span>
                    </div>
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
                      <span>Standardized</span>
                    </span>
                  </div>

                  {/* Multi-segment Weight Visualization Bar */}
                  <div style={{ marginBottom: "18px" }}>
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
                        { label: "CSAT 35%", color: "#2563eb" },
                        { label: "Fulfillment 20%", color: "#4f46e5" },
                        { label: "Returns 20%", color: "#059669" },
                        { label: "Disputes 15%", color: "#d97706" },
                        { label: "History 10%", color: "#9333ea" },
                      ].map((l) => (
                        <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "#64748b", fontWeight: 500 }}>
                          <div style={{ width: "7px", height: "7px", borderRadius: "50%", backgroundColor: l.color }} />
                          {l.label}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Factor Breakdown Rows */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    
                    {/* 1. CSAT */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Star size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>Customer Satisfaction</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>Verified buyer reviews and product CSAT</div>
                        </div>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "14.5px", color: "#2563eb", backgroundColor: "#eff6ff", padding: "2px 8px", borderRadius: "6px" }}>35%</span>
                    </div>

                    {/* 2. Fulfillment */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#e0e7ff", color: "#4f46e5", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Package size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>Fulfillment performance</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>On-time delivery and order fulfillment</div>
                        </div>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "14.5px", color: "#4f46e5", backgroundColor: "#e0e7ff", padding: "2px 8px", borderRadius: "6px" }}>20%</span>
                    </div>

                    {/* 3. Returns */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#ecfdf5", color: "#059669", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <RotateCcw size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>Return performance</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>Return rate and return handling</div>
                        </div>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "14.5px", color: "#059669", backgroundColor: "#ecfdf5", padding: "2px 8px", borderRadius: "6px" }}>20%</span>
                    </div>

                    {/* 4. Disputes */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#fef3c7", color: "#d97706", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <AlertTriangle size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>Dispute rate</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>Dispute rate and chargebacks</div>
                        </div>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "14.5px", color: "#d97706", backgroundColor: "#fef3c7", padding: "2px 8px", borderRadius: "6px" }}>15%</span>
                    </div>

                    {/* 5. History */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", backgroundColor: "#f8fafc", borderRadius: "8px", border: "1px solid #f1f5f9" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <div style={{ width: "32px", height: "32px", borderRadius: "8px", backgroundColor: "#f3e8ff", color: "#9333ea", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Clock size={16} />
                        </div>
                        <div>
                          <div style={{ fontWeight: "700", fontSize: "13.5px", color: "#0f172a" }}>Store history</div>
                          <div style={{ fontSize: "11.5px", color: "#64748b" }}>Account age and sales history</div>
                        </div>
                      </div>
                      <span style={{ fontWeight: "800", fontSize: "14.5px", color: "#9333ea", backgroundColor: "#f3e8ff", padding: "2px 8px", borderRadius: "6px" }}>10%</span>
                    </div>

                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#f8faff",
                    border: "1px solid #dbeafe",
                    borderRadius: "10px",
                    padding: "12px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "12px",
                    color: "#1e40af",
                    marginBottom: "24px",
                  }}
                >
                  <Lock size={15} color="#2563eb" style={{ flexShrink: 0 }} />
                  <span>These weights are standardized and cannot be modified.</span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={nextStep}
                    style={{
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px 28px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 4: Your Trust Score eligibility ── */}
            {step === 4 && (
              <div>
                <h1 style={{ fontSize: "24px", fontWeight: "800", color: "#0f172a", margin: "0 0 10px 0", letterSpacing: "-0.02em" }}>
                  Your Trust Score eligibility
                </h1>
                <p style={{ fontSize: "13.5px", color: "#475569", margin: "0 0 24px 0", lineHeight: "1.5" }}>
                  {"You'll get your score and badge once you meet both requirements."}
                </p>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "18px", marginBottom: "14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "#ecfdf5", color: "#16a34a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                          <line x1="3" y1="6" x2="21" y2="6"></line>
                          <path d="M16 10a4 4 0 0 1-8 0"></path>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0f172a" }}>20 completed orders</div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>Minimum number of completed orders</div>
                      </div>
                    </div>
                    <div style={{ fontWeight: "800", fontSize: "16px", color: "#2563eb" }}>
                      {completedOrders} <span style={{ color: "#94a3b8", fontWeight: "500", fontSize: "13px" }}>/ {targetOrders}</span>
                    </div>
                  </div>
                  <div style={{ width: "100%", height: "7px", backgroundColor: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${ordersPercent}%`, height: "100%", backgroundColor: "#16a34a", borderRadius: "4px" }}></div>
                  </div>
                </div>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "18px", marginBottom: "18px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                      <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: "#eff6ff", color: "#2563eb", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                          <line x1="16" y1="2" x2="16" y2="6"></line>
                          <line x1="8" y1="2" x2="8" y2="6"></line>
                          <line x1="3" y1="10" x2="21" y2="10"></line>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", fontSize: "14.5px", color: "#0f172a" }}>30 days store age</div>
                        <div style={{ fontSize: "12px", color: "#64748b" }}>Minimum number of days your store must be active</div>
                      </div>
                    </div>
                    <div style={{ fontWeight: "800", fontSize: "16px", color: "#2563eb" }}>
                      {storeAgeDays} <span style={{ color: "#94a3b8", fontWeight: "500", fontSize: "13px" }}>/ {targetAgeDays}</span>
                    </div>
                  </div>
                  <div style={{ width: "100%", height: "7px", backgroundColor: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                    <div style={{ width: `${agePercent}%`, height: "100%", backgroundColor: "#2563eb", borderRadius: "4px" }}></div>
                  </div>
                </div>

                <div
                  style={{
                    backgroundColor: "#eff6ff",
                    border: "1px solid #dbeafe",
                    borderRadius: "10px",
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    fontSize: "12px",
                    color: "#1e40af",
                    marginBottom: "28px",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="16" x2="12" y2="12"></line>
                    <line x1="12" y1="8" x2="12.01" y2="8"></line>
                  </svg>
                  <span>Both requirements must be met to display your TrustLayer score and badge on your storefront.</span>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={nextStep}
                    style={{
                      backgroundColor: "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px 28px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: "pointer",
                      boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                    }}
                  >
                    Continue
                  </button>
                </div>
              </div>
            )}

            {/* ── STEP 5: Enable your TrustLayer badge ── */}
            {step === 5 && (
              <div>
                <h1 style={{ fontSize: "22px", fontWeight: "800", color: "#0f172a", margin: "0 0 6px 0", letterSpacing: "-0.02em" }}>
                  Enable your TrustLayer badge
                </h1>
                <p style={{ fontSize: "13px", color: "#475569", margin: "0 0 16px 0", lineHeight: "1.4" }}>
                  Choose where you want your TrustLayer badge to appear.
                </p>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", backgroundColor: "#ffffff", marginBottom: "14px" }}>
                  {/* Toggle: Show TrustLayer badge */}
                  <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                      <div
                        style={{
                          width: "44px",
                          height: "44px",
                          borderRadius: "10px",
                          backgroundColor: "#f8fafc",
                          border: "1px solid #f1f5f9",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>Show TrustLayer badge</div>
                        <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "2px" }}>Display your score and badge on your storefront</div>
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
                        width: "46px",
                        height: "26px",
                        borderRadius: "14px",
                        backgroundColor: badgeEnabled ? "#2563eb" : "#cbd5e1",
                        padding: "2px",
                        display: "flex",
                        alignItems: "center",
                        cursor: "pointer",
                        transition: "background-color 0.2s ease",
                        boxSizing: "border-box",
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
                      ></div>
                    </div>
                  </div>
                </div>

                  {/* ── Live Preview Section: Product Page Only ── */}
                  <div style={{ border: "1px solid #e2e8f0", borderRadius: "12px", padding: "12px 14px", marginBottom: "16px", backgroundColor: "#ffffff", boxShadow: "0 2px 8px -2px rgba(0, 0, 0, 0.04)" }}>
                    {/* Header Bar */}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div
                          style={{
                            width: "8px",
                            height: "8px",
                            borderRadius: "50%",
                            backgroundColor: badgeEnabled ? "#16a34a" : "#94a3b8",
                            boxShadow: badgeEnabled ? "0 0 0 3px rgba(22, 163, 74, 0.15)" : "none",
                          }}
                        ></div>
                        <span style={{ fontSize: "13.5px", fontWeight: "700", color: "#0f172a", letterSpacing: "-0.01em" }}>
                          Live Storefront Preview
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "700",
                          backgroundColor: "#eff6ff",
                          color: "#2563eb",
                          padding: "3px 9px",
                          borderRadius: "20px",
                          border: "1px solid #dbeafe",
                        }}
                      >
                        📦 Product Page
                      </span>
                    </div>

                    {/* Browser Chrome Window Mockup */}
                    <div
                      style={{
                        border: "1px solid #e2e8f0",
                        borderRadius: "12px",
                        backgroundColor: "#f8fafc",
                        overflow: "hidden",
                        boxShadow: "0 3px 10px rgba(0, 0, 0, 0.03)",
                      }}
                    >
                      {/* Browser Address Bar Header */}
                      <div
                        style={{
                          padding: "8px 12px",
                          backgroundColor: "#ffffff",
                          borderBottom: "1px solid #f1f5f9",
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                        }}
                      >
                        <div style={{ display: "flex", gap: "5px", alignItems: "center" }}>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#fca5a5" }}></div>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#fcd34d" }}></div>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#86efac" }}></div>
                        </div>
                        <div
                          style={{
                            flex: 1,
                            backgroundColor: "#f8fafc",
                            borderRadius: "6px",
                            padding: "3px 10px",
                            fontSize: "10.5px",
                            color: "#64748b",
                            display: "flex",
                            alignItems: "center",
                            gap: "5px",
                            border: "1px solid #f1f5f9",
                          }}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                          </svg>
                          <span>store.com/products/velvet-armchair</span>
                        </div>
                      </div>

                      {/* Canvas Area */}
                      <div style={{ padding: "16px", minHeight: "175px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                        {!badgeEnabled ? (
                          <div style={{ textAlign: "center", padding: "20px 12px" }}>
                            <div
                              style={{
                                width: "42px",
                                height: "42px",
                                borderRadius: "50%",
                                backgroundColor: "#f1f5f9",
                                color: "#94a3b8",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                margin: "0 auto 8px auto",
                              }}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                <line x1="1" y1="1" x2="23" y2="23"></line>
                              </svg>
                            </div>
                            <div style={{ fontSize: "13px", fontWeight: "700", color: "#334155" }}>
                              Badge is currently turned off
                            </div>
                            <p style={{ fontSize: "11.5px", color: "#64748b", margin: "3px 0 10px 0" }}>
                              Enable the switch above to display your trust score badge to customers.
                            </p>
                            <button
                              type="button"
                              onClick={() => setBadgeEnabled(true)}
                              style={{
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
                              Turn on badge
                            </button>
                          </div>
                        ) : (
                          <div>
                            <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "8px", fontWeight: "500" }}>
                              Home &gt; Living Room &gt; Velvet Chair
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: "14px", alignItems: "flex-start" }}>
                              {/* Product Image Frame */}
                              <div
                                style={{
                                  width: "96px",
                                  height: "120px",
                                  backgroundColor: "#ffffff",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: "8px",
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "40px",
                                  boxShadow: "0 2px 4px rgba(0,0,0,0.02)",
                                  flexShrink: 0,
                                }}
                              >
                                🪑
                              </div>

                              {/* Product Info & CTA */}
                              <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                                <div>
                                  <div style={{ fontWeight: "800", fontSize: "13.5px", color: "#0f172a" }}>
                                    Minimalist Velvet Armchair
                                  </div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                                    <span style={{ fontWeight: "800", fontSize: "13px", color: "#0f172a" }}>$249.00</span>
                                    <span style={{ fontSize: "11px", color: "#94a3b8", textDecoration: "line-through" }}>$320.00</span>
                                    <span style={{ fontSize: "10px", color: "#16a34a", fontWeight: "700" }}>● In stock</span>
                                  </div>
                                </div>

                                {/* Add to Cart Button */}
                                <div
                                  style={{
                                    backgroundColor: "#0f172a",
                                    color: "#ffffff",
                                    borderRadius: "6px",
                                    padding: "7px 12px",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: "6px",
                                    boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
                                  }}
                                >
                                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"></path>
                                    <line x1="3" y1="6" x2="21" y2="6"></line>
                                    <path d="M16 10a4 4 0 0 1-8 0"></path>
                                  </svg>
                                  Add to Cart
                                </div>

                                {/* TrustLayer Badge Below ATC */}
                                <div
                                  style={{
                                    border: "1.5px solid #3b82f6",
                                    borderRadius: "8px",
                                    padding: "6px 10px",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    backgroundColor: "#ffffff",
                                    boxShadow: "0 2px 8px rgba(37, 99, 235, 0.12)",
                                    position: "relative",
                                  }}
                                >
                                  <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                                    <div
                                      style={{
                                        width: "24px",
                                        height: "24px",
                                        borderRadius: "5px",
                                        backgroundColor: "#eff6ff",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                      }}
                                    >
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M12 2L4 5V11C4 16.55 7.42 21.74 12 23C16.58 21.74 20 16.55 20 11V5L12 2Z" fill="#2563eb" />
                                        <path d="M9 11.5L11 13.5L15.5 9" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                                      </svg>
                                    </div>
                                    <div>
                                      <div style={{ fontSize: "13px", fontWeight: "900", color: "#0f172a", lineHeight: 1 }}>
                                        87 <span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: "600" }}>/100</span>
                                      </div>
                                      <div style={{ fontSize: "8.5px", color: "#64748b", fontWeight: "600", marginTop: "1px" }}>TrustLayer Score</div>
                                    </div>
                                  </div>
                                  <div style={{ borderLeft: "1px solid #e2e8f0", paddingLeft: "8px", display: "flex", flexDirection: "column", gap: "1px" }}>
                                    <div style={{ color: "#16a34a", fontSize: "10.5px", letterSpacing: "1px", fontWeight: "bold", lineHeight: 1 }}>
                                      ★★★★★
                                    </div>
                                    <div style={{ fontSize: "8px", color: "#16a34a", fontWeight: "700" }}>Verified Store</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>


                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    onClick={handleFinish}
                    disabled={isSubmitting}
                    style={{
                      backgroundColor: isSubmitting ? "#94a3b8" : "#2563eb",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "12px 28px",
                      fontSize: "14px",
                      fontWeight: "600",
                      cursor: isSubmitting ? "not-allowed" : "pointer",
                      boxShadow: "0 2px 4px rgba(37, 99, 235, 0.2)",
                    }}
                  >
                    {isSubmitting ? "Finishing..." : "Finish Setup"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
