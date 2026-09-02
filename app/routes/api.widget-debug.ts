import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

// Debug endpoint — open this in browser to check if widget API can reach the DB
// Usage: https://{tunnel-url}/api/widget-debug?shop=announcement-generator-2.myshopify.com
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json",
  };

  if (!shop) {
    return new Response(
      JSON.stringify({ error: "Add ?shop=yourstore.myshopify.com to the URL" }),
      { status: 400, headers }
    );
  }

  try {
    const settings = await prisma.appSettings.findUnique({ where: { shop } });
    const suppliers = await prisma.supplier.findMany({
      where: { shop },
      select: { vendorName: true, trustScore: true, onTimeDeliveryRate: true, returnRate: true, csatRating: true, totalOrders: true },
    });

    return new Response(
      JSON.stringify({
        shop,
        settingsFound: !!settings,
        badgeEnabled: settings?.badgeEnabled ?? null,
        storeTrustScore: settings?.trustScore ?? null,
        storeName: settings?.storeName ?? null,
        onboardingCompleted: settings?.onboardingCompleted ?? null,
        suppliers,
      }, null, 2),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers }
    );
  }
};

