import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";

import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const settings = await prisma.appSettings.findUnique({
    where: { shop },
  });

  const isOnboarded = !!(settings && settings.onboardingCompleted);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", isOnboarded };
};

export default function App() {
  const { apiKey, isOnboarded } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isNavigating = navigation.state !== "idle";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {isNavigating && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            height: "3px",
            background: "linear-gradient(90deg, #2563eb, #60a5fa, #2563eb)",
            backgroundSize: "200% 100%",
            zIndex: 999999,
            animation: "tlNavProgress 1s linear infinite",
          }}
        />
      )}
      <style>{`
        @keyframes tlNavProgress {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
      {isOnboarded && (
        <s-app-nav>
          <s-link href="/app">Overview</s-link>
          <s-link href="/app/performance">Performance</s-link>
          <s-link href="/app/settings">Widget Settings</s-link>
          <s-link href="/app/setting1">Settings</s-link>
        </s-app-nav>
      )}
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
