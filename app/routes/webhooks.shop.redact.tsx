import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async () => {
  return new Response("Webhook endpoint active", { status: 200 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`[TrustLayer] ${topic} received for ${shop}. Deleting store data.`);
  try {
    await prisma.performanceAiSuggestion.deleteMany({ where: { shop } });
    await prisma.supplierAlert.deleteMany({ where: { shop } });
    await prisma.supplier.deleteMany({ where: { shop } });
    await prisma.appSettings.deleteMany({ where: { shop } });
    await prisma.session.deleteMany({ where: { shop } });
  } catch (err) {
    console.error(`[TrustLayer] Failed to delete data during shop/redact for ${shop}:`, err);
  }
  return new Response(null, { status: 200 });
};