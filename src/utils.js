// ===== HTML / URL Utilities =====

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export async function hashUrl(url) {
  const data = new TextEncoder().encode(url);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Validate route params: alphanumeric, hyphens, underscores, dots
export function isValidParam(param) {
  return /^[a-zA-Z0-9._-]+$/.test(param);
}

export function safeDecodeURI(uri) {
  try {
    return decodeURI(uri);
  } catch {
    return uri;
  }
}

export function safeDecodeURIComponent(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

// Decode HTML entities (&#xHEX;, &#DECIMAL;, and common named entities)
export function decodeHtmlEntities(str) {
  if (!str) return str;
  const namedEntities = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    nbsp: "\u00A0", copy: "\u00A9", reg: "\u00AE",
  };
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&(\w+);/g, (match, name) => namedEntities[name.toLowerCase()] ?? match);
}

// ===== Facebook Login Redirect Resolution =====

// Allowed Facebook domains for login redirect resolution
const FACEBOOK_DOMAINS = new Set([
  "www.facebook.com",
  "facebook.com",
  "m.facebook.com",
  "web.facebook.com",
]);

/**
 * Resolve a Facebook login redirect URL back to the intended destination.
 * Returns the resolved URL, or the provided fallbackUrl if resolution fails.
 */
export function resolveLoginRedirect(loginUrl, fallbackUrl) {
  try {
    const parsed = new URL(loginUrl);

    const nextParam = parsed.searchParams.get("next");
    if (!nextParam) {
      console.warn("[LoginResolve] No 'next' parameter found in login URL, falling back to original URL");
      return fallbackUrl;
    }

    const decodedNext = safeDecodeURIComponent(nextParam);
    console.log(`[LoginResolve] Decoded 'next' parameter: ${decodedNext}`);

    const nextUrl = new URL(decodedNext);

    // Validate the next URL points to a Facebook domain (prevent SSRF)
    if (!FACEBOOK_DOMAINS.has(nextUrl.hostname)) {
      console.warn(`[LoginResolve] 'next' URL has non-Facebook domain: ${nextUrl.hostname}, falling back to original URL`);
      return fallbackUrl;
    }

    // Strategy 1: The next URL has story_fbid + id params (permalink.php style)
    const storyFbid = nextUrl.searchParams.get("story_fbid");
    const id = nextUrl.searchParams.get("id");
    if (storyFbid && id) {
      const resolved = `https://www.facebook.com/${id}/posts/${storyFbid}`;
      console.log(`[LoginResolve] Resolved via story_fbid+id: ${resolved}`);
      return resolved;
    }

    // Strategy 2: The next URL has a meaningful path (not just "/")
    if (nextUrl.pathname && nextUrl.pathname !== "/") {
      const resolved = `https://www.facebook.com${nextUrl.pathname}`;
      console.log(`[LoginResolve] Resolved via path: ${resolved}`);
      return resolved;
    }

    console.warn("[LoginResolve] Could not extract usable destination from 'next' URL, falling back to original URL");
    return fallbackUrl;
  } catch (error) {
    console.error("[LoginResolve] Error resolving login redirect:", error);
    return fallbackUrl;
  }
}
