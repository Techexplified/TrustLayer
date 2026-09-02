import prisma from "../db.server";
import type { CollectedVendorData } from "./vendorCollector.server";

export interface AdminGraphQLResponse {
  json: () => Promise<{
    data?: {
      shop?: {
        name?: string;
        myshopifyDomain?: string;
        email?: string;
        currencyCode?: string;
        createdAt?: string;
      };
      products?: {
        nodes?: Array<{
          id: string;
          title: string;
          vendor?: string;
          totalInventory?: number;
          status?: string;
          ratingMetafield?: { value?: string } | null;
          ratingCountMetafield?: { value?: string } | null;
          sprMetafield?: { value?: string } | null;
          judgemeMetafield?: { value?: string } | null;
        }>;
      };
      orders?: {
        nodes?: Array<{
          id: string;
          createdAt: string;
          displayFulfillmentStatus?: string;
          displayFinancialStatus?: string;
          cancelledAt?: string;
          cancelReason?: string;
          returnStatus?: string;
          fulfillments?: Array<{
            id: string;
            createdAt?: string;
            updatedAt?: string;
          }>;
          refunds?: Array<{
            id: string;
            createdAt?: string;
            refundLineItems?: {
              nodes?: Array<{
                quantity?: number;
                lineItem?: {
                  id?: string;
                  vendor?: string;
                };
              }>;
            };
          }>;
          lineItems?: {
            nodes?: Array<{
              id: string;
              vendor?: string;
              quantity?: number;
              originalUnitPriceSet?: {
                shopMoney?: {
                  amount?: string;
                };
              };
            }>;
          };
        }>;
      };
      [key: string]: unknown;
    };
    errors?: unknown[];
  }>;
}

export interface AdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> }
  ) => Promise<AdminGraphQLResponse>;
}

export interface StoreOverviewSummary {
  totalSuppliers: number;
  marketplaceTrustScore: number | null;
  goodPerformancePct: number;
  needingAttentionCount: number;
  eligibleBadgeCount: number;
  onTimeDeliveryRate: number | null;
  returnRate: number;
  disputeRate: number;
  csatRating: number | null;
}

export async function fetchAndSyncStoreDetails(admin: AdminClient, shop: string) {
  let storeName = "My Store";
  let myshopifyDomain = shop;
  let merchantEmail = "";
  let currencyCode = "USD";
  let storeCreatedAt: Date | null = null;
  let storeAgeDays = 0;
  let completedOrdersCount = 0;

  try {
    const shopRes = await admin.graphql(
      `#graphql
      query getShopDetails {
        shop {
          name
          myshopifyDomain
          email
          currencyCode
          createdAt
        }
      }`
    );
    const shopJson = await shopRes.json();
    const shopData = shopJson.data?.shop;

    if (shopData) {
      storeName = shopData.name || storeName;
      myshopifyDomain = shopData.myshopifyDomain || myshopifyDomain;
      merchantEmail = shopData.email || "";
      currencyCode = shopData.currencyCode || "USD";
      if (shopData.createdAt) {
        storeCreatedAt = new Date(shopData.createdAt);
        const diffMs = Date.now() - storeCreatedAt.getTime();
        storeAgeDays = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
      }
    }
  } catch (err) {
    console.warn("Could not fetch shop profile from Shopify:", err);
  }

  try {
    const ordersRes = await admin.graphql(
      `#graphql
      query getOrdersCount {
        orders(first: 100) {
          nodes {
            id
            displayFulfillmentStatus
          }
        }
      }`
    );
    const ordersJson = await ordersRes.json();
    const ordersData = ordersJson.data?.orders?.nodes || [];
    completedOrdersCount = ordersData.length;
  } catch (err) {
    console.warn("Notice: Orders count query error:", err);
  }

  const settings = await prisma.appSettings.upsert({
    where: { shop },
    update: {
      storeName,
      myshopifyDomain,
      merchantEmail,
      currencyCode,
      storeCreatedAt,
      storeAgeDays,
      completedOrdersCount,
    },
    create: {
      shop,
      storeName,
      myshopifyDomain,
      merchantEmail,
      currencyCode,
      storeCreatedAt,
      storeAgeDays,
      completedOrdersCount,
      onboardingStep: 1,
      onboardingCompleted: false,
      trustScore: 85,
      badgeEnabled: true,
      badgePlacement: "PRODUCT_PAGE_BELOW_ATC",
    },
  });

  return settings;
}

export async function getOrCreateAppSettings(admin: AdminClient, shop: string) {
  let settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  if (!settings) {
    settings = await fetchAndSyncStoreDetails(admin, shop);
  }

  return settings;
}

export async function getStoreOverviewData(
  admin: AdminClient,
  shop: string,
  days: number = 7
) {
  const settings = await getOrCreateAppSettings(admin, shop);
  const { collectAllVendorsData } = await import("./vendorCollector.server");
  const vendorResult = await collectAllVendorsData(admin, shop, days);

  // Persist live collected vendor metrics into DB so widget & proxy always serve fresh overview metrics
  for (const v of vendorResult.suppliers) {
    try {
      await prisma.supplier.upsert({
        where: { shop_vendorName: { shop, vendorName: v.vendorName } },
        update: {
          totalProducts: v.totalProducts,
          totalInventory: v.totalInventory,
          totalOrders: v.totalOrders,
          completedOrders: v.completedOrders,
          totalUnitsSold: v.totalUnitsSold,
          totalRevenue: v.totalRevenue,
          avgFulfillmentHours: v.avgFulfillmentHours,
          onTimeDeliveryRate: v.onTimeDeliveryRate !== null ? v.onTimeDeliveryRate : 100,
          refundedUnitsCount: v.refundedUnitsCount,
          returnRate: v.returnRate,
          disputedOrdersCount: v.disputedOrdersCount,
          disputeRate: v.disputeRate,
          csatRating: v.csatRating !== null ? v.csatRating : 0.0,
          trustScore: v.trustScore !== null ? v.trustScore : 85,
          isEligibleForBadge: v.isEligibleForBadge,
          status: v.status,
          firstOrderAt: v.firstOrderAt,
          lastOrderAt: v.lastOrderAt,
          updatedAt: new Date(),
        },
        create: {
          shop,
          vendorName: v.vendorName,
          totalProducts: v.totalProducts,
          totalInventory: v.totalInventory,
          totalOrders: v.totalOrders,
          completedOrders: v.completedOrders,
          totalUnitsSold: v.totalUnitsSold,
          totalRevenue: v.totalRevenue,
          avgFulfillmentHours: v.avgFulfillmentHours,
          onTimeDeliveryRate: v.onTimeDeliveryRate !== null ? v.onTimeDeliveryRate : 100,
          refundedUnitsCount: v.refundedUnitsCount,
          returnRate: v.returnRate,
          disputedOrdersCount: v.disputedOrdersCount,
          disputeRate: v.disputeRate,
          csatRating: v.csatRating !== null ? v.csatRating : 0.0,
          trustScore: v.trustScore !== null ? v.trustScore : 85,
          isEligibleForBadge: v.isEligibleForBadge,
          status: v.status,
          firstOrderAt: v.firstOrderAt,
          lastOrderAt: v.lastOrderAt,
        },
      });
    } catch (e) {
      console.warn("Could not sync supplier:", v.vendorName, e);
    }
  }

  // Sum completed (fulfilled) orders across all vendors and persist back to AppSettings
  const totalCompletedOrders = vendorResult.suppliers.reduce(
    (sum, v) => sum + (v.completedOrders || 0),
    0
  );

  try {
    await prisma.appSettings.update({
      where: { shop },
      data: {
        completedOrdersCount: totalCompletedOrders,
        ...(vendorResult.summary.marketplaceTrustScore !== null
          ? { trustScore: vendorResult.summary.marketplaceTrustScore }
          : {}),
      },
    });
  } catch {
    // ignore
  }

  const alerts = await prisma.supplierAlert.findMany({
    where: { shop, isResolved: false },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      supplier: true,
    },
  });

  return {
    shop,
    settings,
    suppliers: vendorResult.suppliers as CollectedVendorData[],
    summary: vendorResult.summary as StoreOverviewSummary,
    alerts,
  };
}

export interface MarketplaceBenchmark {
  avgTrustScore: number;
  avgOnTimeDelivery: number;
  avgReturnRate: number;
  avgDisputeRate: number;
  avgCsat: number;
  totalStores: number;
  totalSuppliers: number;
  sampleSizeLabel: string;
}

export async function getMarketplaceBenchmarkData(): Promise<MarketplaceBenchmark> {
  try {
    const totalStores = await prisma.appSettings.count({
      where: { onboardingCompleted: true },
    });

    const supplierAgg = await prisma.supplier.aggregate({
      _avg: {
        trustScore: true,
        onTimeDeliveryRate: true,
        returnRate: true,
        disputeRate: true,
        csatRating: true,
      },
      _count: {
        id: true,
      },
    });

    const totalSuppliers = supplierAgg._count.id;
    const hasData = totalSuppliers > 0;

    const avgTrustScore = hasData && supplierAgg._avg.trustScore != null
      ? Math.round(supplierAgg._avg.trustScore)
      : 75;

    const avgOnTimeDelivery = hasData && supplierAgg._avg.onTimeDeliveryRate != null
      ? Math.round(supplierAgg._avg.onTimeDeliveryRate)
      : 90;

    const avgReturnRate = hasData && supplierAgg._avg.returnRate != null
      ? parseFloat(supplierAgg._avg.returnRate.toFixed(1))
      : 3.5;

    const avgDisputeRate = hasData && supplierAgg._avg.disputeRate != null
      ? parseFloat(supplierAgg._avg.disputeRate.toFixed(1))
      : 0.5;

    const avgCsat = hasData && supplierAgg._avg.csatRating != null
      ? parseFloat(supplierAgg._avg.csatRating.toFixed(1))
      : 4.6;

    const sampleSizeLabel = totalStores > 1
      ? `Based on ${totalStores} stores & ${totalSuppliers} suppliers`
      : "Based on marketplace baseline standard";

    return {
      avgTrustScore,
      avgOnTimeDelivery,
      avgReturnRate,
      avgDisputeRate,
      avgCsat,
      totalStores: Math.max(1, totalStores),
      totalSuppliers,
      sampleSizeLabel,
    };
  } catch (err) {
    console.warn("Could not compute marketplace benchmarks:", err);
    return {
      avgTrustScore: 75,
      avgOnTimeDelivery: 90,
      avgReturnRate: 3.5,
      avgDisputeRate: 0.5,
      avgCsat: 4.6,
      totalStores: 1,
      totalSuppliers: 0,
      sampleSizeLabel: "Based on marketplace baseline standard",
    };
  }
}
