import prisma from "../db.server";

// Helper: Calculate standard weighted Trust Score (0 - 100)
// Reviews (35%), Fulfillment (20%), Returns (20%), Disputes (15%), History (10%)
export function calculateWeightedTrustScore(
  onTimeDeliveryRate: number,
  returnRate: number,
  disputeRate: number,
  productCount: number,
  totalOrders: number,
  csatRating?: number | null
): number {
  const sReviews = csatRating !== null && csatRating !== undefined && csatRating > 0 ? (csatRating / 5.0) * 100 : 90;
  const sFulfill = Math.min(100, Math.max(0, onTimeDeliveryRate));
  const sReturn = Math.max(0, 100 - returnRate * 10);
  const sDispute = Math.max(0, 100 - disputeRate * 50);
  const sHistory = Math.min(100, (productCount > 0 ? 50 : 0) + (totalOrders >= 5 ? 50 : 25));

  const score = Math.round(
    sReviews * 0.35 +
    sFulfill * 0.20 +
    sReturn * 0.20 +
    sDispute * 0.15 +
    sHistory * 0.10
  );
  return Math.min(100, Math.max(40, score));
}

// 1. PRODUCTS WEBHOOK HANDLER
export async function handleProductWebhook(shop: string, topic: string, payload: Record<string, unknown>) {
  try {
    const rawVendor = typeof payload.vendor === "string" ? payload.vendor.trim() : "Default Supplier";
    const vendorName = rawVendor || "Default Supplier";
    const variants = Array.isArray(payload.variants) ? payload.variants : [];
    const totalInventory = variants.reduce(
      (sum: number, v: unknown) => {
        const item = v as Record<string, unknown>;
        return sum + (typeof item.inventory_quantity === "number" ? item.inventory_quantity : 0);
      },
      0
    );

    if (topic === "products/delete") {
      const existing = await prisma.supplier.findUnique({
        where: { shop_vendorName: { shop, vendorName } },
      });
      if (existing) {
        const newProdCount = Math.max(0, existing.totalProducts - 1);
        const newTrust = calculateWeightedTrustScore(
          existing.onTimeDeliveryRate,
          existing.returnRate,
          existing.disputeRate,
          newProdCount,
          existing.totalOrders,
          existing.csatRating
        );
        await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            totalProducts: newProdCount,
            trustScore: newTrust,
          },
        });
      }
      return;
    }

    // products/create or products/update
    const existing = await prisma.supplier.findUnique({
      where: { shop_vendorName: { shop, vendorName } },
    });

    if (existing) {
      const newProdCount = topic === "products/create" ? existing.totalProducts + 1 : Math.max(1, existing.totalProducts);
      const newInventory = Math.max(0, existing.totalInventory + totalInventory);
      const newTrust = calculateWeightedTrustScore(
        existing.onTimeDeliveryRate,
        existing.returnRate,
        existing.disputeRate,
        newProdCount,
        existing.totalOrders,
        existing.csatRating
      );

      await prisma.supplier.update({
        where: { id: existing.id },
        data: {
          totalProducts: newProdCount,
          totalInventory: newInventory,
          trustScore: newTrust,
        },
      });
    } else {
      // Upsert new supplier
      const newTrust = calculateWeightedTrustScore(95, 0.0, 0.0, 1, 0, 5.0);
      await prisma.supplier.create({
        data: {
          shop,
          vendorName,
          totalProducts: 1,
          totalInventory,
          totalOrders: 0,
          completedOrders: 0,
          totalUnitsSold: 0,
          totalRevenue: 0,
          refundedUnitsCount: 0,
          disputedOrdersCount: 0,
          onTimeDeliveryRate: 95,
          returnRate: 0.0,
          disputeRate: 0.0,
          csatRating: 5.0,
          trustScore: newTrust,
          status: "GOOD",
          isEligibleForBadge: false,
        },
      });
    }
  } catch (err) {
    console.error(`Error in handleProductWebhook (${topic}):`, err);
  }
}

// 2. ORDERS WEBHOOK HANDLER
export async function handleOrderWebhook(shop: string, topic: string, payload: Record<string, unknown>) {
  try {
    const lineItems = Array.isArray(payload.line_items) ? (payload.line_items as Array<Record<string, unknown>>) : [];
    const isCancelled = Boolean(payload.cancelled_at);
    const isFulfilled = payload.fulfillment_status === "fulfilled";
    const totalAmount = parseFloat(String(payload.total_price || "0")) || 0;
    const createdAt = payload.created_at ? new Date(String(payload.created_at)) : new Date();

    for (const item of lineItems) {
      const rawVendor = typeof item.vendor === "string" ? item.vendor.trim() : "Default Supplier";
      const vendorName = rawVendor || "Default Supplier";
      const qty = typeof item.quantity === "number" ? item.quantity : 1;
      const price = parseFloat(String(item.price || "0")) || (totalAmount > 0 ? totalAmount / Math.max(1, lineItems.length) : 0);

      const existing = await prisma.supplier.findUnique({
        where: { shop_vendorName: { shop, vendorName } },
      });

      if (!existing) {
        const trustScore = calculateWeightedTrustScore(95, 0.0, 0.0, 1, 1, 5.0);
        await prisma.supplier.create({
          data: {
            shop,
            vendorName,
            totalProducts: 1,
            totalInventory: 10,
            totalOrders: 1,
            completedOrders: isFulfilled ? 1 : 0,
            totalUnitsSold: qty,
            totalRevenue: price * qty,
            refundedUnitsCount: isCancelled ? qty : 0,
            disputedOrdersCount: 0,
            onTimeDeliveryRate: 95,
            returnRate: 0.0,
            disputeRate: 0.0,
            csatRating: 5.0,
            trustScore,
            status: "GOOD",
            isEligibleForBadge: false,
            lastOrderAt: createdAt,
          },
        });
        continue;
      }

      // Update existing supplier metrics
      let totalOrders = existing.totalOrders;
      let completedOrders = existing.completedOrders;
      let totalUnitsSold = existing.totalUnitsSold;
      let totalRevenue = existing.totalRevenue;
      let refundedUnitsCount = existing.refundedUnitsCount;
      let disputedOrdersCount = existing.disputedOrdersCount;

      if (topic === "orders/create") {
        totalOrders += 1;
        totalUnitsSold += qty;
        totalRevenue += price * qty;
      }

      if (isFulfilled) {
        completedOrders = Math.min(totalOrders, completedOrders + 1);
      }

      if (isCancelled) {
        refundedUnitsCount += qty;
        if (payload.cancel_reason === "customer") {
          disputedOrdersCount += 1;
        }
      }

      // Rates
      const returnRate = parseFloat(
        Math.min(25, (refundedUnitsCount / Math.max(1, totalUnitsSold)) * 100).toFixed(1)
      );
      const disputeRate = parseFloat(
        Math.min(10, (disputedOrdersCount / Math.max(1, totalOrders)) * 100).toFixed(1)
      );
      const onTimeDeliveryRate = Math.min(
        99,
        Math.max(70, Math.round((completedOrders / Math.max(1, totalOrders)) * 96))
      );
      const csatRating = parseFloat(
        Math.max(3.5, Math.min(5.0, 5.0 - returnRate * 0.1 - disputeRate * 0.2)).toFixed(1)
      );

      const trustScore = calculateWeightedTrustScore(
        onTimeDeliveryRate,
        returnRate,
        disputeRate,
        existing.totalProducts,
        totalOrders,
        csatRating
      );

      let status = "GOOD";
      if (trustScore < 70 || returnRate > 8.0) {
        status = "CRITICAL";
      } else if (trustScore < 80 || returnRate > 4.0) {
        status = "NEEDS_ATTENTION";
      }

      await prisma.supplier.update({
        where: { id: existing.id },
        data: {
          totalOrders,
          completedOrders,
          totalUnitsSold,
          totalRevenue,
          refundedUnitsCount,
          disputedOrdersCount,
          returnRate,
          disputeRate,
          onTimeDeliveryRate,
          csatRating,
          trustScore,
          status,
          isEligibleForBadge: totalOrders >= 5 && existing.totalProducts >= 1 && trustScore >= 75,
          lastOrderAt: createdAt,
        },
      });
    }
  } catch (err) {
    console.error(`Error in handleOrderWebhook (${topic}):`, err);
  }
}

// 3. FULFILLMENTS WEBHOOK HANDLER
export async function handleFulfillmentWebhook(shop: string, topic: string, payload: Record<string, unknown>) {
  try {
    const lineItems = Array.isArray(payload.line_items) ? (payload.line_items as Array<Record<string, unknown>>) : [];

    for (const item of lineItems) {
      const rawVendor = typeof item.vendor === "string" ? item.vendor.trim() : "Default Supplier";
      const vendorName = rawVendor || "Default Supplier";
      const existing = await prisma.supplier.findUnique({
        where: { shop_vendorName: { shop, vendorName } },
      });

      if (existing) {
        const completedOrders = Math.min(existing.totalOrders, existing.completedOrders + 1);
        const onTimeDeliveryRate = Math.min(
          99,
          Math.max(70, Math.round((completedOrders / Math.max(1, existing.totalOrders)) * 96))
        );
        const trustScore = calculateWeightedTrustScore(
          onTimeDeliveryRate,
          existing.returnRate,
          existing.disputeRate,
          existing.totalProducts,
          existing.totalOrders,
          existing.csatRating
        );

        await prisma.supplier.update({
          where: { id: existing.id },
          data: {
            completedOrders,
            onTimeDeliveryRate,
            trustScore,
          },
        });
      }
    }
  } catch (err) {
    console.error(`Error in handleFulfillmentWebhook (${topic}):`, err);
  }
}

// 4. SHOP WEBHOOK HANDLER
export async function handleShopWebhook(shop: string, payload: Record<string, unknown>) {
  try {
    const storeName = typeof payload.name === "string" ? payload.name : undefined;
    const merchantEmail = typeof payload.email === "string" ? payload.email : undefined;
    const currencyCode = typeof payload.currency === "string" ? payload.currency : typeof payload.currencyCode === "string" ? payload.currencyCode : undefined;
    const myshopifyDomain = typeof payload.myshopify_domain === "string" ? payload.myshopify_domain : shop;

    await prisma.appSettings.upsert({
      where: { shop },
      update: {
        ...(storeName ? { storeName } : {}),
        ...(merchantEmail ? { merchantEmail } : {}),
        ...(currencyCode ? { currencyCode } : {}),
        ...(myshopifyDomain ? { myshopifyDomain } : {}),
      },
      create: {
        shop,
        storeName: storeName || "My Store",
        merchantEmail: merchantEmail || "",
        currencyCode: currencyCode || "USD",
        myshopifyDomain: myshopifyDomain || shop,
      },
    });
  } catch (err) {
    console.error("Error in handleShopWebhook:", err);
  }
}
