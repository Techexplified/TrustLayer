import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// Public CORS headers — allows storefront theme scripts to call this endpoint
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

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
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const vendorName = url.searchParams.get("vendor");

  if (!shop) {
    return new Response(
      JSON.stringify({ success: false, error: "Missing shop parameter" }),
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const settings = await prisma.appSettings.findUnique({ where: { shop } });

    let vendorData = null;
    if (vendorName) {
      const trimmed = vendorName.trim();
      // Try exact match or case-insensitive match
      const supplier = await prisma.supplier.findFirst({
        where: {
          shop,
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
    const totalReviews = 0; // Actual verified reviews count

    const payload = {
      success: true,
      shop,
      storeName: settings?.storeName || shop.split(".")[0],
      settings: {
        badgeEnabled: settings?.badgeEnabled ?? true,
        showOnProductPages: settings?.showOnProductPages ?? true,
        showOnSellerProfile: settings?.showOnSellerProfile ?? true,
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
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error("[/api/widget] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error" }),
      { status: 500, headers: corsHeaders }
    );
  }
};
