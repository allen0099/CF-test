import { decodeHtmlEntities } from "./utils.js";
import { cacheGet, cachePut } from "./cache.js";

export async function fetchMetadata(env, url) {
  const cached = await cacheGet(env, url);
  if (cached) {
    console.log("Cache HIT for:", url);
    return { ...cached, _cacheHit: true };
  }

  console.log("Cache MISS for:", url);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      },
    });

    if (!response.ok) throw new Error(`Failed to fetch ${url}`);

    const html = await response.text();

    const getMeta = (prop) => {
      const match =
        html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`, "i")) ||
        html.match(new RegExp(`<meta name="${prop}" content="([^"]*)"`, "i")) ||
        html.match(new RegExp(`<meta property="${prop}" content='([^']*)'`, "i"));
      return match ? decodeHtmlEntities(match[1]) : null;
    };

    // Log canonical URL if present (some sites put the real URL here)
    const canonicalMatch =
      html.match(/<link rel="canonical" href="([^"]*)"/i) ||
      html.match(/<link rel="canonical" href='([^']*)'/i);
    if (canonicalMatch) {
      console.log(`[Metadata] Found canonical URL: ${decodeHtmlEntities(canonicalMatch[1])}`);
    }

    // Log alternate x-default URL if present (internationalization)
    const alternateMatch =
      html.match(/<link rel="alternate" hreflang="x-default" href="([^"]*)"/i) ||
      html.match(/<link rel="alternate" hreflang="x-default" href='([^']*)'/i);
    if (alternateMatch) {
      console.log(`[Metadata] Found alternate x-default URL: ${decodeHtmlEntities(alternateMatch[1])}`);
    }

    const title = getMeta("og:title") || getMeta("title") || "";
    const description = getMeta("og:description") || getMeta("description") || "";
    const image = getMeta("og:image") || "";
    const site_name = getMeta("og:site_name") || "";
    let urlFromMeta = getMeta("og:url") || url;

    // If og:url requires login, fall back to the original URL
    if (urlFromMeta.includes("/login/")) {
      console.warn(`[Metadata] og:url requires login: ${urlFromMeta}`);
      urlFromMeta = url;
      // urlFromMeta = resolveLoginRedirect(urlFromMeta, url);
      console.log(`[Metadata] Final resolved URL: ${urlFromMeta}`);
    }

    const metadata = {
      og: { title, description, image, url: urlFromMeta, site_name },
      meta: { title, description, url: urlFromMeta },
    };

    const ttl = parseInt(env.CACHE_TTL, 10) || 3600;
    await cachePut(env, url, metadata, ttl);

    return { ...metadata, _cacheHit: false };
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return {
      og: {
        title: "Error",
        description: "Could not fetch metadata",
        image: "",
        url,
        site_name: "",
      },
      meta: { title: "Error", description: "Could not fetch metadata", url },
      _cacheHit: false,
    };
  }
}
