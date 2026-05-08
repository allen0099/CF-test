import { htmlResponse } from "./utils.js";
import { isBlocked, generateBlockedPage } from "./blocklist.js";
import { fetchMetadata } from "./metadata.js";
import { generateHtmlWithMetadata } from "./html.js";
import { sendTelegramLog } from "./telegram/logger.js";

function getClientIp(request) {
  // Get client IP from CF header, then X-real-ip, then fallback to "unknown"
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function handleLinkRequest(request, env, executionCtx, facebookUrl) {
  const visitorIp = getClientIp(request);
  const timestamp = new Date().toISOString();

  // Phase 1: Check blocklist against input URL
  const inputBlock = await isBlocked(env, facebookUrl);
  if (inputBlock.blocked) {
    executionCtx.waitUntil(
      sendTelegramLog(env, {
        facebookUrl,
        visitorIp,
        timestamp,
        cacheHit: false,
        blocked: true,
        blockReason: inputBlock.reason,
      })
    );
    return htmlResponse(generateBlockedPage(facebookUrl, inputBlock.reason), 403);
  }

  // Phase 2: Fetch metadata (with KV cache)
  const metadata = await fetchMetadata(env, facebookUrl);
  const cacheHit = metadata._cacheHit;

  // Phase 3: Check blocklist against resolved URL (og:url may differ)
  const resolvedUrl = metadata.meta.url ?? metadata.og.url ?? facebookUrl;
  if (resolvedUrl !== facebookUrl) {
    const resolvedBlock = await isBlocked(env, resolvedUrl);
    if (resolvedBlock.blocked) {
      executionCtx.waitUntil(
        sendTelegramLog(env, {
          facebookUrl,
          visitorIp,
          timestamp,
          cacheHit,
          blocked: true,
          blockReason: resolvedBlock.reason,
          resolvedUrl,
        })
      );
      return htmlResponse(generateBlockedPage(resolvedUrl, resolvedBlock.reason), 403);
    }
  }

  // Phase 4: Generate response HTML
  const html = generateHtmlWithMetadata(metadata, facebookUrl);

  // Phase 5: Send Telegram log asynchronously (does not block response)
  executionCtx.waitUntil(
    sendTelegramLog(env, {
      facebookUrl,
      visitorIp,
      timestamp,
      cacheHit,
      blocked: false,
      resolvedUrl,
    })
  );

  return htmlResponse(html);
}
