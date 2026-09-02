(function () {
  if (window.TrustLayerWidgetLoaded) return;
  window.TrustLayerWidgetLoaded = true;

  async function initTrustLayer() {
    const shop = window.TrustLayerShop || (window.Shopify ? window.Shopify.shop : window.location.hostname);
    const vendor = getPageVendor();

    // Prefer App Proxy on same origin, with fallback to direct API
    const proxyUrl = window.location.origin + "/apps/trust-layer?shop=" + encodeURIComponent(shop) + (vendor ? "&vendor=" + encodeURIComponent(vendor) : "");
    const directUrl = window.TrustLayerApiUrl ? (window.TrustLayerApiUrl + "?shop=" + encodeURIComponent(shop) + (vendor ? "&vendor=" + encodeURIComponent(vendor) : "")) : null;

    let data = null;

    // 1. Try App Proxy first
    try {
      const res = await fetch(proxyUrl);
      if (res.ok) {
        data = await res.json();
      }
    } catch (e) {
      console.warn("[TrustLayer] App Proxy note:", e);
    }

    // 2. Fallback to direct API if proxy failed
    if (!data && directUrl) {
      try {
        const res = await fetch(directUrl, { mode: "cors" });
        if (res.ok) {
          data = await res.json();
        }
      } catch (e) {
        console.warn("[TrustLayer] Direct API note:", e);
      }
    }

    if (!data || !data.success) {
      // Reveal existing static badges if API fails so page is not permanently blank
      document.querySelectorAll(".trust-layer-block-root").forEach(el => el.classList.add("tl-ready"));
      return;
    }

    const { settings, metrics, storeName } = data;

    // Feature 1: Global Enable/Disable check
    if (settings.badgeEnabled === false) {
      document.querySelectorAll(".trust-layer-block-root").forEach(el => el.remove());
      return;
    }

    // Feature 2: Display Settings — showOnProductPages
    if (isProductPage()) {
      if (settings.showOnProductPages === false) {
        document.querySelectorAll(".trust-layer-block-root").forEach(el => el.remove());
      } else {
        const blockElements = document.querySelectorAll(".trust-layer-block-root");
        if (blockElements.length > 0) {
          blockElements.forEach(function (el) {
            renderConfiguredBadge(el, settings, metrics, storeName);
            repositionElement(el, settings.badgePlacement);
            el.classList.add("tl-ready");
          });
        } else {
          injectConfiguredBadge(settings, metrics, storeName);
        }
      }
    }

    // Feature 3: Display Settings — showOnCartPage (Cart Protection Banner)
    if (settings.showOnCartPage) {
      injectCartBanner(storeName, metrics);
      // Listen for cart drawer mutations/updates
      setupCartListeners(storeName, metrics);
    }
  }

  function getTrustColor(score) {
    if (score === null || score === undefined) return "#10b981";
    if (score >= 85) return "#10b981";
    if (score >= 70) return "#f59e0b";
    return "#ef4444";
  }

  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function getPageVendor() {
    if (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) {
      return window.ShopifyAnalytics.meta.product.vendor || null;
    }
    const blockEl = document.querySelector(".trust-layer-block-root[data-vendor]");
    if (blockEl) return blockEl.getAttribute("data-vendor");
    return null;
  }

  function isProductPage() {
    return window.location.pathname.includes("/products/");
  }

  function isCartPage() {
    return window.location.pathname.includes("/cart") || !!document.querySelector("form[action*='/cart']") || !!document.querySelector("cart-drawer");
  }

  // Render badge without internal operational status pills
  function renderConfiguredBadge(container, settings, metrics, storeName) {
    const style = settings.badgeStyle || "FULL";
    const isCompact = settings.compactMode === true || style === "COMPACT";
    const isMinimal = style === "MINIMAL";
    const showScore = settings.showNumericScore !== false;
    const showReviews = settings.showProductReviews !== false;

    const currentVendor = container.getAttribute("data-vendor") || storeName;
    const score = metrics.storeTrustScore || 85;
    const trustColor = getTrustColor(score);

    // Reviews data
    const prodRatingAttr = container.getAttribute("data-product-rating");
    const prodReviewsAttr = container.getAttribute("data-product-reviews");
    const prodReviewsCount = prodReviewsAttr !== null ? parseInt(prodReviewsAttr, 10) : (metrics.totalReviews || 0);
    const prodRatingVal = prodRatingAttr !== null ? parseFloat(prodRatingAttr) : (metrics.csatRating || 0);

    const reviewsText = prodReviewsCount > 0 && prodRatingVal > 0
      ? `${prodRatingVal.toFixed(1)} ★ (${prodReviewsCount} ${prodReviewsCount === 1 ? "review" : "reviews"})`
      : "0.0 ★ (0 reviews)";
    const reviewsPct = prodReviewsCount > 0 && prodRatingVal > 0
      ? Math.min(100, Math.round((prodRatingVal / 5.0) * 100))
      : 0;

    const onTimeRate = metrics.onTimeRate !== null && metrics.onTimeRate !== undefined ? metrics.onTimeRate : 100;
    const returnRate = metrics.returnRate !== null && metrics.returnRate !== undefined ? metrics.returnRate : 0;

    // 1. Minimal Style
    if (isMinimal) {
      container.innerHTML = `
        <div class="tl-badge-minimal">
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
            ${showReviews ? `<span style="color: #f59e0b; font-weight: 700; font-size: 11px;">⭐ ${reviewsText}</span><span style="color: #cbd5e1;">•</span>` : ""}
            <span style="color: ${trustColor}; font-size: 14px;">🛡️</span>
            <span style="font-weight: 800; color: #0f172a; font-size: 12px;">
              ${showScore ? `${score}/100 Vendor Trust` : `Verified Supplier`}
            </span>
            <span style="font-size: 11px; color: #64748b;">· by <strong>${escapeHtml(currentVendor)}</strong></span>
          </div>
          <span class="tl-badge-brand-tag">🛡️ TrustLayer</span>
        </div>
      `;
      return;
    }

    // 2. Compact Style
    if (isCompact) {
      container.innerHTML = `
        <div class="tl-badge-compact">
          <div class="tl-badge-compact-left">
            ${showReviews ? `
              <div style="display: flex; align-items: center; gap: 4px;">
                <span style="color: #f59e0b; font-size: 11px;">⭐</span>
                <span style="font-weight: 800; color: #0f172a; font-size: 11px;">${reviewsText}</span>
                <span style="color: #cbd5e1; margin-left: 2px;">•</span>
              </div>
            ` : ""}
            <span style="color: ${trustColor}; font-size: 15px;">🛡️</span>
            ${showScore ? `
              <span class="tl-compact-score" style="color: ${trustColor};">${score}<span class="tl-compact-denom">/100</span></span>
            ` : ""}
            <span style="font-size: 11px; color: #64748b;">by <strong>${escapeHtml(currentVendor)}</strong></span>
          </div>
          <span class="tl-badge-brand-tag">🛡️ TrustLayer</span>
        </div>
      `;
      return;
    }

    // 3. Full Card Style
    container.innerHTML = `
      <div class="tl-badge-full">
        <div class="tl-badge-full-header">
          <div class="tl-badge-shield-wrap">
            <div class="tl-badge-icon" style="background-color: ${trustColor === '#10b981' ? '#ecfdf5' : trustColor + '15'}; color: ${trustColor};">🛡️</div>
            <div>
              <div class="tl-badge-score-line">
                ${showScore ? `
                  <span class="tl-badge-score-val" style="color: ${trustColor};">${score}</span>
                  <span class="tl-badge-score-denom">/100</span>
                  <span class="tl-badge-score-title">Vendor Trust</span>
                ` : `
                  <span class="tl-badge-score-title" style="font-size: 15px; font-weight: 800; color: ${trustColor}; margin-left: 0;">Verified Supplier</span>
                `}
              </div>
              <div class="tl-badge-tier-line">
                <span class="tl-badge-vendor-by">by <strong>${escapeHtml(currentVendor)}</strong></span>
              </div>
            </div>
          </div>
          <span class="tl-badge-brand-tag">🛡️ TrustLayer</span>
        </div>

        <div class="tl-badge-metrics">
          ${showReviews ? `
            <div class="tl-metric-row">
              <span class="tl-metric-label"> Product reviews (Item)</span>
              <div class="tl-metric-val-wrap">
                <span class="tl-metric-val">${reviewsText}</span>
                <div class="tl-progress-bar"><div class="tl-progress-fill-amber" style="width: ${reviewsPct}%;"></div></div>
              </div>
            </div>
          ` : ""}
          <div class="tl-metric-row">
            <span class="tl-metric-label"> Vendor on-time shipping</span>
            <div class="tl-metric-val-wrap">
              <span class="tl-metric-val">${onTimeRate}%</span>
              <div class="tl-progress-bar"><div class="tl-progress-fill-green" style="width: ${onTimeRate}%;"></div></div>
            </div>
          </div>
          <div class="tl-metric-row">
            <span class="tl-metric-label"> Vendor return rate</span>
            <div class="tl-metric-val-wrap">
              <span class="tl-metric-val">${parseFloat(returnRate).toFixed(1)}%</span>
              <div class="tl-progress-bar"><div class="tl-progress-fill-green" style="width: 25%;"></div></div>
            </div>
          </div>
        </div>

        <div class="tl-badge-footer">
          <span>Verified supplier &amp; listing</span>
          <span class="tl-badge-confidence">🛡️ Shop with confidence</span>
        </div>
      </div>
    `;
  }

  // Feature 4: Precise positioning
  function repositionElement(el, placement) {
    if (!placement) return;

    if (placement === "PRODUCT_PAGE_STICKY_BOTTOM") {
      el.className = "trust-layer-block-root tl-badge-sticky-bar";
      document.body.appendChild(el);
      return;
    }

    const atcForm = document.querySelector("form[action*='/cart/add']") || document.querySelector(".product-form") || document.querySelector("product-form");
    const atcButton = document.querySelector("button[name='add']") || document.querySelector(".product-form__submit") || document.querySelector("input[type='submit'][name='add']");
    const description = document.querySelector(".product__description") || document.querySelector(".product-single__description") || document.querySelector(".rte") || document.querySelector(".product__info-container .product__description");

    if (placement === "PRODUCT_PAGE_ABOVE_ATC") {
      if (atcButton && atcButton.parentNode) {
        atcButton.parentNode.insertBefore(el, atcButton);
      } else if (atcForm && atcForm.parentNode) {
        atcForm.parentNode.insertBefore(el, atcForm);
      }
    } else if (placement === "PRODUCT_PAGE_BELOW_DESC") {
      if (description && description.parentNode) {
        description.parentNode.insertBefore(el, description.nextSibling);
      }
    } else if (placement === "PRODUCT_PAGE_BELOW_ATC") {
      if (atcForm && atcForm.parentNode) {
        atcForm.parentNode.insertBefore(el, atcForm.nextSibling);
      } else if (atcButton && atcButton.parentNode) {
        atcButton.parentNode.insertBefore(el, atcButton.nextSibling);
      }
    }
  }

  function injectConfiguredBadge(settings, metrics, storeName) {
    const targetDiv = document.createElement("div");
    targetDiv.className = "trust-layer-block-root tl-badge-container";
    renderConfiguredBadge(targetDiv, settings, metrics, storeName);

    const placement = settings.badgePlacement || "PRODUCT_PAGE_BELOW_ATC";

    repositionElement(targetDiv, placement);
    if (!targetDiv.parentNode) {
      (document.querySelector("main") || document.body).appendChild(targetDiv);
    }
    targetDiv.classList.add("tl-ready");
  }

  async function injectCartBanner(storeName, metrics) {
    if (document.querySelector(".tl-cart-banner")) return;
    const cartContainer = document.querySelector("form[action*='/cart']") ||
                          document.querySelector(".cart__items") ||
                          document.querySelector(".cart-drawer__items") ||
                          document.querySelector("cart-drawer") ||
                          document.querySelector(".cart__contents");
    if (!cartContainer) return;

    let sellerLabel = storeName;

    // Fetch actual vendor(s) from cart items via Shopify /cart.js
    try {
      const cartRes = await fetch("/cart.js");
      if (cartRes.ok) {
        const cartData = await cartRes.json();
        if (cartData && Array.isArray(cartData.items) && cartData.items.length > 0) {
          const vendors = [...new Set(cartData.items.map(function(i) { return i.vendor; }).filter(Boolean))];
          if (vendors.length === 1) {
            sellerLabel = vendors[0];
          } else if (vendors.length > 1) {
            sellerLabel = vendors.slice(0, 2).join(" & ");
          }
        }
      }
    } catch (e) {
      console.warn("[TrustLayer] Cart items fetch note:", e);
    }

    // Fallback: check DOM elements for vendor
    if (!sellerLabel || sellerLabel.includes("announcement-generator") || sellerLabel === "My Store") {
      const domVendor = document.querySelector(".cart-item__vendor, .cart__item-vendor, [data-cart-item-vendor]");
      if (domVendor && domVendor.textContent && domVendor.textContent.trim()) {
        sellerLabel = domVendor.textContent.trim();
      }
    }

    const banner = document.createElement("div");
    banner.className = "tl-cart-banner";
    banner.innerHTML = `
      <span style="font-size: 16px;">🛡️</span>
      <div><strong>TrustLayer Protected:</strong> <strong>${escapeHtml(sellerLabel)}</strong> is a verified seller with on-time delivery assurance.</div>
    `;
    cartContainer.parentNode.insertBefore(banner, cartContainer);
  }

  function setupCartListeners(storeName, metrics) {
    // Re-check for cart drawer when user adds items or opens drawer
    const observer = new MutationObserver(function() {
      if (!document.querySelector(".tl-cart-banner")) {
        injectCartBanner(storeName, metrics);
      }
    });

    const drawer = document.querySelector("cart-drawer") || document.querySelector("#cart-drawer") || document.body;
    if (drawer) {
      observer.observe(drawer, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initTrustLayer);
  } else {
    initTrustLayer();
  }
})();
