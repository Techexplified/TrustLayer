import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

function getTierName(score: number | null, status?: string): string {
  if (status === "NEEDS_ATTENTION") return "Attention";
  if (status === "CRITICAL") return "Critical";
  if (score === null || score === undefined) return "Healthy";
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Healthy";
  if (score >= 60) return "Needs Review";
  return "Critical";
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopParam = url.searchParams.get("shop");

  if (!shopParam) {
    return new Response(JSON.stringify({ error: "Missing shop" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const settings = await prisma.appSettings.findUnique({ where: { shop: shopParam } });

    const vendorName = url.searchParams.get("vendor");
    let vendorData = null;
    if (vendorName) {
      const trimmed = vendorName.trim();
      const supplier = await prisma.supplier.findFirst({
        where: {
          shop: shopParam,
          vendorName: {
            equals: trimmed,
            mode: "insensitive",
          },
        },
      });

      if (supplier) {
        vendorData = {
          vendorName: supplier.vendorName,
          trustScore: supplier.trustScore,
          status: supplier.status,
          onTimeDeliveryRate: supplier.onTimeDeliveryRate,
          returnRate: supplier.returnRate,
          csatRating: supplier.csatRating,
          totalProducts: supplier.totalProducts,
          totalOrders: supplier.totalOrders,
        };
      }
    }

    const displayScore = vendorData?.trustScore ?? settings?.trustScore ?? 85;
    const displayOnTime = vendorData?.onTimeDeliveryRate ?? 100;
    const displayReturnRate = vendorData?.returnRate != null ? vendorData.returnRate : 0.0;
    const displayCsat = vendorData?.csatRating ?? 0.0;
    const totalReviews = 0;

    // ── Eligibility Gate ────────────────────────────────────────────────────
    // The storefront widget only shows when BOTH conditions are met:
    //   1. Store has at least 20 completed (fulfilled) orders
    //   2. Store has been active for at least 30 days
    const ORDERS_THRESHOLD = 20;
    const AGE_THRESHOLD_DAYS = 30;

    const completedOrdersCount = settings?.completedOrdersCount ?? 0;

    // Compute store age from storeAgeDays field or storeCreatedAt fallback
    let storeAgeDays: number = settings?.storeAgeDays ?? 0;
    if (storeAgeDays === 0 && settings?.storeCreatedAt) {
      storeAgeDays = Math.floor(
        (Date.now() - new Date(settings.storeCreatedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    const eligibilityMet =
      completedOrdersCount >= ORDERS_THRESHOLD && storeAgeDays >= AGE_THRESHOLD_DAYS;

    // Even if merchant toggled badge on, gate it behind eligibility
    const badgeEnabled = (settings?.badgeEnabled ?? true) && eligibilityMet;

    return new Response(
      JSON.stringify({
        success: true,
        shop: shopParam,
        storeName: settings?.storeName || shopParam.split(".")[0],
        eligibility: {
          met: eligibilityMet,
          completedOrders: completedOrdersCount,
          ordersRequired: ORDERS_THRESHOLD,
          storeAgeDays,
          ageRequired: AGE_THRESHOLD_DAYS,
        },
        settings: {
          badgeEnabled,
          showOnProductPages: settings?.showOnProductPages ?? true,
          showOnCartPage: settings?.showOnCartPage ?? false,
          showProductReviews: settings?.showProductReviews ?? true,
          badgePlacement: settings?.badgePlacement || "PRODUCT_PAGE_BELOW_ATC",
          badgeStyle: settings?.badgeStyle || "FULL",
          compactMode: settings?.compactMode ?? false,
          showNumericScore: settings?.showNumericScore ?? true,
        },
        metrics: {
          storeTrustScore: displayScore,
          tierName: getTierName(displayScore, vendorData?.status),
          onTimeRate: displayOnTime,
          returnRate: displayReturnRate,
          csatRating: displayCsat,
          totalReviews,
        },
        vendor: vendorData,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[App Proxy] Error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
