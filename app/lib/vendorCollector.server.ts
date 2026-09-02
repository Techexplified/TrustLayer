import type { AdminClient } from "./storeMetrics.server";

export interface ProductReviewItem {
  productId: string;
  title: string;
  rating: number | null;
  reviewCount: number;
  inventoryQuantity: number;
  status: string;
}

export interface CollectedVendorData {
  id?: string;
  vendorName: string;
  totalProducts: number;
  totalInventory: number;
  totalOrders: number;
  completedOrders: number;
  totalUnitsSold: number;
  totalRevenue: number;
  avgFulfillmentHours: number;
  refundedUnitsCount: number;
  disputedOrdersCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
  trustScore: number | null;        // null = no sales yet (Unrated)
  onTimeDeliveryRate: number | null; // null = no fulfilled orders yet
  returnRate: number;
  disputeRate: number;
  csatRating: number | null;        // null = no completed orders or reviews to rate
  isEligibleForBadge: boolean;
  status: "GOOD" | "NEEDS_ATTENTION" | "CRITICAL";
  products: ProductReviewItem[];
  totalReviewCount: number;
  avgProductRating: number | null;
}

export async function collectAllVendorsData(
  admin: AdminClient,
  shop: string,
  days: number = 7
) {
  // Calculate sinceDate starting from the beginning of the day (days) ago relative to current date
  const now = new Date();
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  since.setUTCHours(0, 0, 0, 0);
  const sinceDateFormatted = since.toISOString().split("T")[0]; // YYYY-MM-DD

  const vendorMap = new Map<
    string,
    {
      vendorName: string;
      productCount: number;
      totalInventory: number;
      orderIds: Set<string>;
      completedOrderIds: Set<string>;
      overdueOrderIds: Set<string>;
      totalUnits: number;
      totalRevenue: number;
      fulfillmentDurationsHours: number[];
      refundedUnits: number;
      disputedOrders: number;
      firstOrderAt: Date | null;
      lastOrderAt: Date | null;
      products: ProductReviewItem[];
      totalReviewCount: number;
    }
  >();

  const getOrCreateVendorRecord = (name: string) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    if (!vendorMap.has(trimmed)) {
      vendorMap.set(trimmed, {
        vendorName: trimmed,
        productCount: 0,
        totalInventory: 0,
        orderIds: new Set<string>(),
        completedOrderIds: new Set<string>(),
        overdueOrderIds: new Set<string>(),
        totalUnits: 0,
        totalRevenue: 0,
        fulfillmentDurationsHours: [],
        refundedUnits: 0,
        disputedOrders: 0,
        firstOrderAt: null,
        lastOrderAt: null,
        products: [],
        totalReviewCount: 0,
      });
    }
    return vendorMap.get(trimmed)!;
  };

  // Phase 1: Products & Product Review Metafields
  try {
    const productsRes = await admin.graphql(
      `#graphql
      query getProductsVendors {
        products(first: 250) {
          nodes {
            id
            title
            vendor
            totalInventory
            status
            ratingMetafield: metafield(namespace: "reviews", key: "rating") {
              value
            }
            ratingCountMetafield: metafield(namespace: "reviews", key: "rating_count") {
              value
            }
            sprMetafield: metafield(namespace: "spr", key: "reviews") {
              value
            }
            judgemeMetafield: metafield(namespace: "judgeme", key: "badge") {
              value
            }
          }
        }
      }`
    );
    const productsJson = await productsRes.json();
    const products = productsJson.data?.products?.nodes || [];
    for (const prod of products) {
      if (prod.vendor && prod.vendor.trim()) {
        const record = getOrCreateVendorRecord(prod.vendor.trim());
        if (record) {
          record.productCount += 1;
          record.totalInventory += prod.totalInventory || 0;

          // Parse Product Reviews Metafields
          let rating: number | null = null;
          let reviewCount = 0;

          // 1. Standard Shopify reviews.rating & reviews.rating_count
          if (prod.ratingMetafield?.value) {
            try {
              const parsed = JSON.parse(prod.ratingMetafield.value);
              if (typeof parsed === "object" && parsed !== null && parsed.value) {
                rating = parseFloat(parsed.value);
              } else if (typeof parsed === "number") {
                rating = parsed;
              }
            } catch {
              const parsedNum = parseFloat(prod.ratingMetafield.value);
              if (!isNaN(parsedNum)) {
                rating = parsedNum;
              }
            }
          }

          if (prod.ratingCountMetafield?.value) {
            const count = parseInt(prod.ratingCountMetafield.value, 10);
            if (!isNaN(count)) {
              reviewCount = count;
            }
          }

          // 2. Judge.me fallback
          if (rating === null && prod.judgemeMetafield?.value) {
            const val = prod.judgemeMetafield.value;
            const ratingMatch = val.match(/data-average-rating=['"]([\d.]+)['"]/i) || val.match(/rating['"]:\s*([\d.]+)/i);
            const countMatch = val.match(/data-number-of-reviews=['"](\d+)['"]/i) || val.match(/count['"]:\s*(\d+)/i);
            if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            if (countMatch) reviewCount = parseInt(countMatch[1], 10);
          }

          // 3. SPR fallback
          if (rating === null && prod.sprMetafield?.value) {
            const val = prod.sprMetafield.value;
            const ratingMatch = val.match(/data-rating=['"]([\d.]+)['"]/i) || val.match(/rating-value=['"]([\d.]+)['"]/i);
            const countMatch = val.match(/data-count=['"](\d+)['"]/i) || val.match(/review-count=['"](\d+)['"]/i);
            if (ratingMatch) rating = parseFloat(ratingMatch[1]);
            if (countMatch) reviewCount = parseInt(countMatch[1], 10);
          }

          if (rating !== null) {
            rating = Math.max(1.0, Math.min(5.0, parseFloat(rating.toFixed(1))));
          }

          record.products.push({
            productId: prod.id,
            title: prod.title || "Untitled Product",
            rating,
            reviewCount,
            inventoryQuantity: prod.totalInventory || 0,
            status: prod.status || "ACTIVE",
          });

          if (reviewCount > 0) {
            record.totalReviewCount += reviewCount;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Notice: Could not query products by vendor:", err);
  }

  // Phase 2: Orders filtered by current date - days
  try {
    interface RawOrderNode {
      id: string;
      createdAt: string;
      displayFulfillmentStatus?: string;
      displayFinancialStatus?: string;
      cancelledAt?: string;
      cancelReason?: string;
      fulfillments?: Array<{
        id: string;
        createdAt?: string;
        updatedAt?: string;
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
    }

    let orders: RawOrderNode[] = [];

    // Attempt 1: Filtered query (no refunds field — requires extra scope)
    try {
      const ordersRes = await admin.graphql(
        `#graphql
        query getOrdersVendors($query: String) {
          orders(first: 100, query: $query) {
            nodes {
              id
              createdAt
              displayFulfillmentStatus
              displayFinancialStatus
              cancelledAt
              cancelReason
              fulfillments {
                id
                createdAt
                updatedAt
              }
              lineItems(first: 50) {
                nodes {
                  id
                  vendor
                  quantity
                  originalUnitPriceSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }
            }
          }
        }`,
        {
          variables: {
            query: `created_at:>='${sinceDateFormatted}'`,
          },
        }
      );
      const ordersJson = await ordersRes.json();
      if (ordersJson.errors) {
        console.warn("Notice: Filtered orders query errors:", JSON.stringify(ordersJson.errors));
      }
      if (ordersJson.data?.orders?.nodes) {
        orders = ordersJson.data.orders.nodes as RawOrderNode[];
      }
    } catch (queryErr) {
      console.warn("Notice: Filtered orders query exception:", queryErr);
    }

    // Fallback: Query all recent orders without date filter if filtered query returned 0 or errored
    if (orders.length === 0) {
      try {
        const fallbackRes = await admin.graphql(
          `#graphql
          query getRecentOrdersFallback {
            orders(first: 50, sortKey: CREATED_AT, reverse: true) {
              nodes {
                id
                createdAt
                displayFulfillmentStatus
                displayFinancialStatus
                cancelledAt
                cancelReason
                fulfillments {
                  id
                  createdAt
                  updatedAt
                }
                lineItems(first: 50) {
                  nodes {
                    id
                    vendor
                    quantity
                    originalUnitPriceSet {
                      shopMoney {
                        amount
                      }
                    }
                  }
                }
              }
            }
          }`
        );
        const fallbackJson = await fallbackRes.json();
        if (fallbackJson.errors) {
          console.warn("Notice: Fallback orders query errors:", JSON.stringify(fallbackJson.errors));
        }
        if (fallbackJson.data?.orders?.nodes) {
          orders = fallbackJson.data.orders.nodes as RawOrderNode[];
        }
      } catch (fallbackErr) {
        console.warn("Notice: Fallback orders query exception:", fallbackErr);
      }
    }

    const currentTimeMs = now.getTime();

    for (const order of orders) {
      const orderCreatedAt = new Date(order.createdAt);
      const isFulfilled =
        order.displayFulfillmentStatus === "FULFILLED" ||
        (order.fulfillments && order.fulfillments.length > 0);
      const ageHours = (currentTimeMs - orderCreatedAt.getTime()) / (1000 * 60 * 60);
      const isOverdue = !isFulfilled && ageHours > 120;

      const lineItems = order.lineItems?.nodes || [];
      const orderVendors = new Set<string>();

      for (const item of lineItems) {
        if (!item.vendor || !item.vendor.trim()) continue;
        const vendorName = item.vendor.trim();
        orderVendors.add(vendorName);

        const record = getOrCreateVendorRecord(vendorName);
        if (!record) continue;

        record.orderIds.add(order.id);
        if (isFulfilled) record.completedOrderIds.add(order.id);
        if (isOverdue) record.overdueOrderIds.add(order.id);

        const qty = item.quantity || 1;
        const unitPrice = parseFloat(item.originalUnitPriceSet?.shopMoney?.amount || "0");
        record.totalUnits += qty;
        record.totalRevenue += unitPrice * qty;

        if (!record.firstOrderAt || orderCreatedAt < record.firstOrderAt) record.firstOrderAt = orderCreatedAt;
        if (!record.lastOrderAt || orderCreatedAt > record.lastOrderAt) record.lastOrderAt = orderCreatedAt;

        if (order.fulfillments && order.fulfillments.length > 0) {
          const firstFulfillment = order.fulfillments[0];
          const dateStr = firstFulfillment.createdAt || firstFulfillment.updatedAt || order.createdAt;
          const fulfilledAt = new Date(dateStr);
          const diffHours = Math.max(1, (fulfilledAt.getTime() - orderCreatedAt.getTime()) / (1000 * 60 * 60));
          record.fulfillmentDurationsHours.push(diffHours);
        }
      }

      // Track refunds via financial status (no separate refunds query needed)
      if (order.displayFinancialStatus === "REFUNDED" || order.displayFinancialStatus === "PARTIALLY_REFUNDED") {
        for (const item of lineItems) {
          if (!item.vendor || !item.vendor.trim()) continue;
          const record = getOrCreateVendorRecord(item.vendor.trim());
          if (record) {
            const refundQty = order.displayFinancialStatus === "REFUNDED" ? (item.quantity || 1) : 1;
            record.refundedUnits += refundQty;
          }
        }
      }

      // Track cancelled orders as refunds/disputes
      if (order.cancelledAt) {
        for (const item of lineItems) {
          if (!item.vendor || !item.vendor.trim()) continue;
          const record = getOrCreateVendorRecord(item.vendor.trim());
          if (record) {
            record.refundedUnits += item.quantity || 1;
            if (order.cancelReason === "CUSTOMER" || order.cancelReason === "FRAUD") {
              record.disputedOrders += 1;
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("Notice: Could not query orders by vendor:", err);
  }

  // Phase 3: Score & Aggregate
  const calculatedVendors: CollectedVendorData[] = [];

  for (const [vendorName, data] of vendorMap.entries()) {
    const totalOrdersCount = data.orderIds.size;
    const completedOrdersCount = data.completedOrderIds.size;
    const overdueOrdersCount = data.overdueOrderIds.size;

    // Avg fulfillment speed
    const avgFulfillmentHours =
      data.fulfillmentDurationsHours.length > 0
        ? data.fulfillmentDurationsHours.reduce((a, b) => a + b, 0) / data.fulfillmentDurationsHours.length
        : 24;

    // On-Time Delivery: only from confirmed fulfilled orders in this period
    let onTimeDeliveryRate: number | null = null;
    if (data.fulfillmentDurationsHours.length > 0) {
      const onTimeCount = data.fulfillmentDurationsHours.filter((h) => h <= 48).length;
      onTimeDeliveryRate = Math.round((onTimeCount / data.fulfillmentDurationsHours.length) * 100);
    }
    if (overdueOrdersCount > 0 && totalOrdersCount > 0) {
      const baseRate = onTimeDeliveryRate !== null ? onTimeDeliveryRate : 100;
      onTimeDeliveryRate = Math.max(0, Math.round(baseRate * ((totalOrdersCount - overdueOrdersCount) / totalOrdersCount)));
    }

    // Return Rate in period
    const returnRate =
      completedOrdersCount > 0 && data.totalUnits > 0
        ? parseFloat(((data.refundedUnits / data.totalUnits) * 100).toFixed(1))
        : 0.0;

    // Dispute Rate in period
    const disputeRate =
      completedOrdersCount > 0
        ? parseFloat(((data.disputedOrders / completedOrdersCount) * 100).toFixed(1))
        : 0.0;

    // Calculate weighted average rating across all products sold by this vendor
    const ratedProducts = data.products.filter((p) => p.rating !== null);
    let avgProductRating: number | null = null;
    if (ratedProducts.length > 0) {
      let weightedSum = 0;
      let totalWeights = 0;
      for (const p of ratedProducts) {
        const count = p.reviewCount > 0 ? p.reviewCount : 1;
        weightedSum += (p.rating as number) * count;
        totalWeights += count;
      }
      avgProductRating = parseFloat((weightedSum / totalWeights).toFixed(1));
    }

    // CSAT in period: Strictly based on real product reviews (null if 0 reviews exist)
    const csatRating: number | null = avgProductRating !== null ? avgProductRating : null;

    // Period Trust Score: Reviews (35%), Fulfillment (20%), Returns (20%), Disputes (15%), History (10%)
    let trustScore: number | null = null;
    if (completedOrdersCount > 0) {
      const sReviews = avgProductRating !== null ? (avgProductRating / 5.0) * 100 : 90;
      const sFulfill = onTimeDeliveryRate !== null ? onTimeDeliveryRate : 100;
      const sReturn = Math.max(0, 100 - returnRate * 10);
      const sDispute = Math.max(0, 100 - disputeRate * 50);
      const sHistory = Math.min(
        100,
        (data.productCount > 0 ? 50 : 0) + (completedOrdersCount >= 5 ? 50 : completedOrdersCount * 10)
      );
      trustScore = Math.min(
        100,
        Math.max(
          0,
          Math.round(
            sReviews * 0.35 +
            sFulfill * 0.20 +
            sReturn * 0.20 +
            sDispute * 0.15 +
            sHistory * 0.10
          )
        )
      );
    } else if (totalOrdersCount > 0) {
      trustScore = overdueOrdersCount > 0 ? 55 : 65;
    }

    const isEligibleForBadge =
      completedOrdersCount >= 5 &&
      data.productCount >= 1 &&
      trustScore !== null &&
      trustScore >= 75;

    let status: "GOOD" | "NEEDS_ATTENTION" | "CRITICAL" = "GOOD";
    if (completedOrdersCount > 0) {
      const ts = trustScore as number;
      if (ts < 70 || returnRate > 8.0 || disputeRate > 5.0) {
        status = "CRITICAL";
      } else if (ts < 80 || returnRate > 4.0 || (onTimeDeliveryRate !== null && onTimeDeliveryRate < 80)) {
        status = "NEEDS_ATTENTION";
      }
    } else if (totalOrdersCount > 0) {
      status = overdueOrdersCount > 0 ? "CRITICAL" : "NEEDS_ATTENTION";
    }

    const calculated: CollectedVendorData = {
      vendorName,
      totalProducts: data.productCount,
      totalInventory: data.totalInventory,
      totalOrders: totalOrdersCount,
      completedOrders: completedOrdersCount,
      totalUnitsSold: data.totalUnits,
      totalRevenue: parseFloat(data.totalRevenue.toFixed(2)),
      avgFulfillmentHours: parseFloat(avgFulfillmentHours.toFixed(1)),
      refundedUnitsCount: data.refundedUnits,
      disputedOrdersCount: data.disputedOrders,
      firstOrderAt: data.firstOrderAt,
      lastOrderAt: data.lastOrderAt,
      trustScore,
      onTimeDeliveryRate,
      returnRate,
      disputeRate,
      csatRating,
      isEligibleForBadge,
      status,
      products: data.products,
      totalReviewCount: data.totalReviewCount,
      avgProductRating,
    };

    calculatedVendors.push(calculated);
  }

  // Phase 4: Aggregations
  const totalSuppliers = calculatedVendors.length;
  const suppliersWithCompletedOrders = calculatedVendors.filter((v) => v.completedOrders > 0);
  const goodPerformanceCount = suppliersWithCompletedOrders.filter((v) => v.status === "GOOD").length;
  const needingAttentionCount = calculatedVendors.filter(
    (v) => v.status === "NEEDS_ATTENTION" || v.status === "CRITICAL"
  ).length;
  const eligibleBadgeCount = calculatedVendors.filter((v) => v.isEligibleForBadge).length;

  const suppliersWithScore = calculatedVendors.filter((v) => v.trustScore !== null);
  const avgTrustScore: number | null =
    suppliersWithScore.length > 0
      ? Math.round(suppliersWithScore.reduce((acc, v) => acc + (v.trustScore as number), 0) / suppliersWithScore.length)
      : null;

  const suppliersWithFulfillmentData = calculatedVendors.filter((v) => v.onTimeDeliveryRate !== null);
  const avgOnTimeDelivery: number | null =
    suppliersWithFulfillmentData.length > 0
      ? Math.round(
          suppliersWithFulfillmentData.reduce((acc, v) => acc + (v.onTimeDeliveryRate as number), 0) /
            suppliersWithFulfillmentData.length
        )
      : null;

  const activeCount = suppliersWithCompletedOrders.length;

  const avgReturnRate =
    activeCount > 0
      ? parseFloat((suppliersWithCompletedOrders.reduce((acc, v) => acc + v.returnRate, 0) / activeCount).toFixed(1))
      : 0.0;

  const avgDisputeRate =
    activeCount > 0
      ? parseFloat((suppliersWithCompletedOrders.reduce((acc, v) => acc + v.disputeRate, 0) / activeCount).toFixed(1))
      : 0.0;

  const suppliersWithCsat = calculatedVendors.filter((v) => v.csatRating !== null);
  const avgCsat: number | null =
    suppliersWithCsat.length > 0
      ? parseFloat(
          (suppliersWithCsat.reduce((acc, v) => acc + (v.csatRating as number), 0) / suppliersWithCsat.length).toFixed(1)
        )
      : null;

  const goodPerformancePct =
    suppliersWithCompletedOrders.length > 0
      ? Math.round((goodPerformanceCount / suppliersWithCompletedOrders.length) * 100)
      : 0;

  return {
    suppliers: calculatedVendors,
    summary: {
      totalSuppliers,
      marketplaceTrustScore: avgTrustScore,
      goodPerformancePct,
      needingAttentionCount,
      eligibleBadgeCount,
      onTimeDeliveryRate: avgOnTimeDelivery,
      returnRate: avgReturnRate,
      disputeRate: avgDisputeRate,
      csatRating: avgCsat,
    },
  };
}
