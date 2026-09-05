import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async () => {
  return new Response("Webhook endpoint active", { status: 200 });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`[TrustLayer Compliance Webhook] Received ${topic} for ${shop}`);

  switch (topic) {
    case "customers/data_request": {
      // Payload contains: { shop_id, shop_domain, customer: { id, email, phone }, orders_requested }
      // TrustLayer does not store any customer personal data (PII).
      // We only compute aggregate vendor performance metrics from order summaries.
      console.log(`[TrustLayer] customers/data_request received for ${shop}. No customer PII stored.`);
      break;
    }

    case "customers/redact": {
      // Payload contains: { shop_id, shop_domain, customer: { id, email, phone }, orders_to_redact }
      // TrustLayer does not store any customer personal data (PII).
      console.log(`[TrustLayer] customers/redact received for ${shop}. No customer PII stored.`);
      break;
    }

    case "shop/redact": {
      // Payload contains: { shop_id, shop_domain }
      // 48 hours after app uninstall, Shopify requests all store data to be deleted.
      console.log(`[TrustLayer] shop/redact received for ${shop}. Deleting all store data.`);
      try {
        await prisma.performanceAiSuggestion.deleteMany({ where: { shop } });
        await prisma.supplierAlert.deleteMany({ where: { shop } });
        await prisma.supplier.deleteMany({ where: { shop } });
        await prisma.appSettings.deleteMany({ where: { shop } });
        await prisma.session.deleteMany({ where: { shop } });
      } catch (err) {
        console.error(`[TrustLayer] Failed to delete data during shop/redact for ${shop}:`, err);
      }
      break;
    }

    default:
      console.log(`[TrustLayer] Unhandled compliance topic: ${topic}`);
  }

  return new Response(null, { status: 200 });
};