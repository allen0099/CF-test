import { htmlResponse, jsonResponse, isValidParam } from "./src/utils.js";
import { generateLandingPage } from "./src/html.js";
import { matchRoute } from "./src/router.js";
import { handleLinkRequest } from "./src/handler.js";
import { handleTelegramWebhook } from "./src/telegram/bot.js";

// ===== Main Worker Export =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const matched = matchRoute(pathname);

    console.log(`Matched: ${matched.route} for path: ${pathname}`);

    switch (matched.route) {
      case "favicon":
        return new Response(null, { status: 404 });

      case "telegram-webhook":
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", { status: 405 });
        }
        return handleTelegramWebhook(request, env);

      case "landing":
        return htmlResponse(generateLandingPage());

      case "share-type": {
        if (!isValidParam(matched.type) || !isValidParam(matched.id)) {
          return jsonResponse({ error: "Invalid parameters" }, 400);
        }
        const fbUrl = `https://www.facebook.com/share/${matched.type}/${matched.id}`;
        return handleLinkRequest(request, env, ctx, fbUrl);
      }

      case "share": {
        if (!isValidParam(matched.id)) {
          return jsonResponse({ error: "Invalid parameters" }, 400);
        }
        const fbUrl = `https://www.facebook.com/share/${matched.id}`;
        return handleLinkRequest(request, env, ctx, fbUrl);
      }

      case "user-post": {
        if (!isValidParam(matched.username) || !isValidParam(matched.id)) {
          return jsonResponse({ error: "Invalid parameters" }, 400);
        }
        const fbUrl = `https://www.facebook.com/${matched.username}/posts/${matched.id}`;
        return handleLinkRequest(request, env, ctx, fbUrl);
      }

      case "catch-all": {
        if (!isValidParam(matched.id)) {
          return jsonResponse({ error: "Invalid parameters" }, 400);
        }
        const matchedId = matched.id;
        // If the ID doesn't look like a share ID (rule: 10 chars random string)
        // then drop the request to avoid unnecessary processing (e.g. robots.txt, sitemap.xml, .well-known)
        if (!/^[a-zA-Z0-9_-]{10}$/.test(matchedId)) {
          return new Response("Not Found", { status: 404 });
        }

        const fbUrl = `https://www.facebook.com/share/${matchedId}`;
        return handleLinkRequest(request, env, ctx, fbUrl);
      }

      default:
        return new Response("Unknown route", { status: 404 });
    }
  },
};
