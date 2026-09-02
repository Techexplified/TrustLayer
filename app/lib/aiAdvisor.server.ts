import { ChatOpenAI } from "@langchain/openai";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import prisma from "../db.server";

export interface AiSuggestionItem {
  id: string;
  category: "CSAT" | "FULFILLMENT" | "RETURNS" | "DISPUTES" | "SUPPLIERS" | "GENERAL";
  title: string;
  badge: string;
  badgeColor: "blue" | "green" | "amber" | "purple" | "indigo";
  description: string;
  estimatedImpact: string;
  iconType: "star" | "package" | "return" | "shield" | "trending" | "supplier";
}

export interface PerformanceAiData {
  shop: string;
  suggestions: AiSuggestionItem[];
  isGenerated: boolean;
  regenerationCount: number;
  maxRegenerations: number;
  lastGeneratedAt?: string;
  source?: "AI_LIVE" | "CACHE" | "FALLBACK";
}

export interface StoreMetricsSnapshot {
  storeName?: string;
  shop: string;
  overallScore: number | null;
  marketAvgScore: number;
  csatRating: number | null;
  totalReviewCount: number;
  onTimeDeliveryRate: number | null;
  avgFulfillmentHours: number;
  pendingOrders: number;
  returnRate: number;
  totalReturnsCount: number;
  disputeRate: number;
  totalDisputesCount: number;
  storeAgeDays: number;
  suppliers: Array<{
    vendorName: string;
    trustScore: number | null;
    status: string;
    returnRate: number;
    onTimeDeliveryRate: number | null;
  }>;
}

function generateFallbackSuggestions(metrics: StoreMetricsSnapshot): AiSuggestionItem[] {
  const suggestions: AiSuggestionItem[] = [];

  if (!metrics.csatRating || metrics.csatRating < 4.0) {
    const ratingStr = metrics.csatRating ? `${metrics.csatRating}★` : "0.0★";
    suggestions.push({
      id: "tip-csat",
      category: "CSAT",
      title: "Boost Verified Reviews",
      badge: "Top Driver (35%)",
      badgeColor: "blue",
      description: `Your average rating is ${ratingStr} across ${metrics.totalReviewCount} reviews. Product reviews account for 35% of your Trust Score — set up automated post-purchase review requests to lift your score.`,
      estimatedImpact: "+10 to +15 pts lift",
      iconType: "star",
    });
  } else {
    suggestions.push({
      id: "tip-csat-keep",
      category: "CSAT",
      title: "Sustain Review Volume",
      badge: "Strong Driver (35%)",
      badgeColor: "green",
      description: `Your ${metrics.csatRating}★ rating is performing solidly. Continue collecting authentic customer reviews on newly added product listings to maintain score momentum.`,
      estimatedImpact: "Core Score Anchor",
      iconType: "star",
    });
  }

  if (metrics.pendingOrders > 0 || (metrics.onTimeDeliveryRate !== null && metrics.onTimeDeliveryRate < 85)) {
    suggestions.push({
      id: "tip-fulfillment",
      category: "FULFILLMENT",
      title: "Accelerate Dispatch Times",
      badge: "Quick Win (20%)",
      badgeColor: "indigo",
      description: `You have ${metrics.pendingOrders} pending orders. Fulfilling orders with valid tracking numbers within 24–48 hours will maximize your 20% fulfillment reliability pillar.`,
      estimatedImpact: "+6 to +10 pts lift",
      iconType: "package",
    });
  } else {
    suggestions.push({
      id: "tip-fulfillment-ok",
      category: "FULFILLMENT",
      title: "Maintain 24h Pacing",
      badge: "Healthy (20%)",
      badgeColor: "green",
      description: `Your on-time fulfillment rate is ${metrics.onTimeDeliveryRate ?? 100}%. Keep tracking updates synchronized directly with carriers to prevent buyer inquiries.`,
      estimatedImpact: "High Stability",
      iconType: "package",
    });
  }

  const lowScoringSupplier = metrics.suppliers.find((s) => (s.trustScore && s.trustScore < 75) || s.status === "NEEDS_ATTENTION" || s.status === "CRITICAL");
  if (lowScoringSupplier) {
    suggestions.push({
      id: "tip-supplier-return",
      category: "SUPPLIERS",
      title: `Audit ${lowScoringSupplier.vendorName}`,
      badge: "Watch Item",
      badgeColor: "amber",
      description: `${lowScoringSupplier.vendorName} has a return rate of ${lowScoringSupplier.returnRate}% and a trust rating of ${lowScoringSupplier.trustScore ?? "Unrated"}. Review product dimensions and item descriptions to cut refund requests.`,
      estimatedImpact: "+4 to +8 pts lift",
      iconType: "return",
    });
  } else if (metrics.returnRate > 3.0) {
    suggestions.push({
      id: "tip-return-rate",
      category: "RETURNS",
      title: "Reduce Item Return Rate",
      badge: "Key Factor (20%)",
      badgeColor: "amber",
      description: `Your store return rate is at ${metrics.returnRate}% (${metrics.totalReturnsCount} units). Updating size charts and product high-res media can prevent sizing and expectation mismatches.`,
      estimatedImpact: "+5 to +8 pts lift",
      iconType: "return",
    });
  } else {
    suggestions.push({
      id: "tip-dispute-shield",
      category: "DISPUTES",
      title: "Zero Dispute Defense",
      badge: "Protected (15%)",
      badgeColor: "green",
      description: "Zero payment disputes logged. Provide transparent shipping timelines and accessible contact details in your storefront footer to preempt any chargeback filings.",
      estimatedImpact: "15% Weight Maximized",
      iconType: "shield",
    });
  }

  return suggestions;
}

export async function generateAiSuggestionsWithLangChain(
  metrics: StoreMetricsSnapshot
): Promise<{ suggestions: AiSuggestionItem[]; source: "AI_LIVE" | "FALLBACK" }> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey.trim() === "") {
    console.warn("[TrustLayer AI Advisor] No OPENROUTER_API_KEY found in environment. Using calibrated fallback engine.");
    return {
      suggestions: generateFallbackSuggestions(metrics),
      source: "FALLBACK",
    };
  }

  try {
    const chat = new ChatOpenAI({
      modelName: "openai/gpt-4o-mini",
      apiKey: apiKey,
      openAIApiKey: apiKey,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: apiKey,
        defaultHeaders: {
          "HTTP-Referer": "https://trustlayer.app",
          "X-Title": "TrustLayer Shopify App",
        },
      },
      temperature: 0.25,
      maxTokens: 1200,
    });

    const systemPrompt = `You are an expert E-Commerce Operations and Merchant Trust Advisor for TrustLayer on Shopify.
Your job is to analyze real merchant store metrics and generate EXACTLY 3 high-impact, prioritized, actionable suggestions to help the merchant maximize their Trust Score and storefront customer credibility.

The 5 Standard TrustLayer Pillars & Weights:
1. Customer Satisfaction (CSAT & Buyer Reviews) - 35% Weight
2. Fulfillment Performance (On-time dispatch <= 48 hours) - 20% Weight
3. Return Performance (Low return rate <= 3.5%) - 20% Weight
4. Dispute Rate (Zero payment disputes & chargebacks) - 15% Weight
5. Store History & Supplier Stability - 10% Weight

CRITICAL INSTRUCTIONS:
- Generate EXACTLY 3 suggestions tailored to the merchant's live weaknesses and opportunities.
- Reference their exact numbers (ratings, percentages, supplier names, order counts) in the descriptions.
- Suggestion 1 should address their highest-impact opportunity (usually CSAT / Reviews if rating is low or review count is small).
- Suggestion 2 should address operational/fulfillment pacing or pending orders.
- Suggestion 3 should address returns, disputes, or specific underperforming suppliers.
- Output MUST strictly be a valid JSON array of 3 objects with keys: "id", "category", "title", "badge", "badgeColor", "description", "estimatedImpact", "iconType".
- Valid badgeColors: "blue", "green", "amber", "purple", "indigo".
- Valid iconTypes: "star", "package", "return", "shield", "trending", "supplier".
- Valid categories: "CSAT", "FULFILLMENT", "RETURNS", "DISPUTES", "SUPPLIERS", "GENERAL".
- Return ONLY valid raw JSON or fenced JSON.`;

    const scoreStr = metrics.overallScore !== null ? `${metrics.overallScore}/100` : "Unrated (0 completed orders)";
    const csatStr = metrics.csatRating !== null ? `${metrics.csatRating} / 5.0 Stars` : "0.0 Stars";
    const onTimeStr = metrics.onTimeDeliveryRate !== null ? `${metrics.onTimeDeliveryRate}%` : "100% (baseline)";
    const dispatchSpeed = `${(metrics.avgFulfillmentHours / 24).toFixed(1)} days (${metrics.avgFulfillmentHours.toFixed(1)} hrs)`;

    const userPrompt = `Here is the current operational data for store "${metrics.storeName || metrics.shop}":
- Current Trust Score: ${scoreStr} (Market Benchmark Average: ${metrics.marketAvgScore}/100)
- Customer Satisfaction: ${csatStr} across ${metrics.totalReviewCount} reviews (Market CSAT Baseline: 4.6 Stars)
- Fulfillment Performance: On-Time Delivery ${onTimeStr}, Avg Dispatch Speed: ${dispatchSpeed}, Pending Fulfillments: ${metrics.pendingOrders} orders
- Return Performance: Return Rate ${metrics.returnRate}% with ${metrics.totalReturnsCount} returned units (Market Return Baseline: 2.4% - 3.5%)
- Dispute Performance: Dispute Rate ${metrics.disputeRate}% with ${metrics.totalDisputesCount} active disputes (Market Dispute Baseline: 0.5%)
- Store Platform Age: ${metrics.storeAgeDays} days
- Connected Suppliers: ${JSON.stringify(metrics.suppliers)}

Generate exactly 3 prioritized, highly practical suggestions for this store.`;

    const response = await chat.invoke([
      new SystemMessage(systemPrompt),
      new HumanMessage(userPrompt),
    ]);

    const content = typeof response.content === "string" ? response.content : JSON.stringify(response.content);

    const cleaned = content
      .replace(/```json\s*/gi, "")
      .replace(/```\s*$/gi, "")
      .trim();

    const parsed = JSON.parse(cleaned) as AiSuggestionItem[];

    if (Array.isArray(parsed) && parsed.length >= 3) {
      return {
        suggestions: parsed.slice(0, 3).map((item, idx) => ({
          id: item.id || `tip-${idx + 1}`,
          category: item.category || "GENERAL",
          title: item.title || "Performance Opportunity",
          badge: item.badge || "Key Factor",
          badgeColor: ["blue", "green", "amber", "purple", "indigo"].includes(item.badgeColor) ? item.badgeColor : "blue",
          description: item.description || "Optimize store operations to maintain high trust.",
          estimatedImpact: item.estimatedImpact || "+5 to +10 pts",
          iconType: ["star", "package", "return", "shield", "trending", "supplier"].includes(item.iconType) ? item.iconType : "star",
        })),
        source: "AI_LIVE",
      };
    }

    console.warn("[TrustLayer AI Advisor] Received non-standard AI payload, applying fallback:", content);
    return {
      suggestions: generateFallbackSuggestions(metrics),
      source: "FALLBACK",
    };
  } catch (err) {
    console.error("[TrustLayer AI Advisor] Error invoking OpenRouter GPT-4o Mini:", err);
    return {
      suggestions: generateFallbackSuggestions(metrics),
      source: "FALLBACK",
    };
  }
}

/**
 * Loads stored suggestions from DB
 */
export async function getStoreAiSuggestions(shop: string): Promise<PerformanceAiData> {
  const MAX_REGENERATIONS = 5;

  try {
    const existing = await prisma.performanceAiSuggestion.findUnique({
      where: { shop },
    });

    if (existing && existing.isGenerated && existing.suggestions) {
      try {
        const parsed = JSON.parse(existing.suggestions) as AiSuggestionItem[];
        return {
          shop,
          suggestions: parsed,
          isGenerated: true,
          regenerationCount: existing.regenerationCount,
          maxRegenerations: MAX_REGENERATIONS,
          lastGeneratedAt: existing.lastGeneratedAt.toISOString(),
          source: "CACHE",
        };
      } catch (parseErr) {
        console.warn("[TrustLayer AI Advisor] Corrupted stored suggestions JSON:", parseErr);
      }
    }

    return {
      shop,
      suggestions: [],
      isGenerated: false,
      regenerationCount: existing ? existing.regenerationCount : 0,
      maxRegenerations: MAX_REGENERATIONS,
    };
  } catch (e) {
    console.error("[TrustLayer AI Advisor] Error reading AI suggestions:", e);
    return {
      shop,
      suggestions: [],
      isGenerated: false,
      regenerationCount: 0,
      maxRegenerations: MAX_REGENERATIONS,
    };
  }
}

/**
 * Generates initial suggestions on first button click
 */
export async function generateInitialStoreAiSuggestions(
  shop: string,
  metrics: StoreMetricsSnapshot
): Promise<{ success: boolean; data?: PerformanceAiData; error?: string }> {
  const MAX_REGENERATIONS = 5;

  try {
    const { suggestions, source } = await generateAiSuggestionsWithLangChain(metrics);

    const saved = await prisma.performanceAiSuggestion.upsert({
      where: { shop },
      update: {
        suggestions: JSON.stringify(suggestions),
        isGenerated: true,
        regenerationCount: 0,
        lastGeneratedAt: new Date(),
      },
      create: {
        shop,
        suggestions: JSON.stringify(suggestions),
        isGenerated: true,
        regenerationCount: 0,
        lastGeneratedAt: new Date(),
      },
    });

    return {
      success: true,
      data: {
        shop,
        suggestions,
        isGenerated: true,
        regenerationCount: saved.regenerationCount,
        maxRegenerations: MAX_REGENERATIONS,
        lastGeneratedAt: saved.lastGeneratedAt.toISOString(),
        source,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to generate AI suggestions.";
    console.error("[TrustLayer AI Advisor] Error generating initial suggestions:", err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}

/**
 * Regenerates suggestions on demand, strictly enforcing the 5-regeneration limit on backend
 */
export async function regenerateStoreAiSuggestions(
  shop: string,
  metrics: StoreMetricsSnapshot
): Promise<{ success: boolean; data?: PerformanceAiData; error?: string }> {
  const MAX_REGENERATIONS = 5;

  try {
    const existing = await prisma.performanceAiSuggestion.findUnique({
      where: { shop },
    });

    const currentCount = existing ? existing.regenerationCount : 0;

    if (currentCount >= MAX_REGENERATIONS) {
      return {
        success: false,
        error: `Regeneration limit reached (${MAX_REGENERATIONS}/${MAX_REGENERATIONS}). You have used all available attempts.`,
      };
    }

    const { suggestions, source } = await generateAiSuggestionsWithLangChain(metrics);
    const nextCount = currentCount + 1;

    const updated = await prisma.performanceAiSuggestion.upsert({
      where: { shop },
      update: {
        suggestions: JSON.stringify(suggestions),
        isGenerated: true,
        regenerationCount: nextCount,
        lastGeneratedAt: new Date(),
      },
      create: {
        shop,
        suggestions: JSON.stringify(suggestions),
        isGenerated: true,
        regenerationCount: nextCount,
        lastGeneratedAt: new Date(),
      },
    });

    return {
      success: true,
      data: {
        shop,
        suggestions,
        isGenerated: true,
        regenerationCount: updated.regenerationCount,
        maxRegenerations: MAX_REGENERATIONS,
        lastGeneratedAt: updated.lastGeneratedAt.toISOString(),
        source,
      },
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "Failed to regenerate AI suggestions.";
    console.error("[TrustLayer AI Advisor] Error in regenerateStoreAiSuggestions:", err);
    return {
      success: false,
      error: errorMsg,
    };
  }
}
