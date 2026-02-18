
// ===== Utilities =====

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function hashUrl(url) {
  const data = new TextEncoder().encode(url);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// Validate route params: alphanumeric, hyphens, underscores, dots
function isValidParam(param) {
  return /^[a-zA-Z0-9._-]+$/.test(param);
}

function safeDecodeURI(uri) {
  try {
    return decodeURI(uri);
  } catch {
    return uri;
  }
}

// ===== KV Cache =====

async function cacheGet(env, url) {
  const key = await hashUrl(url);
  return env.METADATA_CACHE.get(key, { type: "json" });
}

async function cachePut(env, url, metadata, ttl) {
  const key = await hashUrl(url);
  await env.METADATA_CACHE.put(key, JSON.stringify(metadata), {
    expirationTtl: ttl,
  });
}

// ===== Telegram Log =====

async function sendTelegramLog(env, logData) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("Telegram credentials not configured, skipping log");
    return;
  }

  const lines = [
    `📋 <b>Link Request Log</b>`,
    ``,
    `🔗 <b>URL:</b> <code>${escapeHtml(logData.facebookUrl)}</code>`,
    `🌐 <b>Visitor IP:</b> <code>${escapeHtml(logData.visitorIp)}</code>`,
    `🕐 <b>Time:</b> ${escapeHtml(logData.timestamp)}`,
    `📊 <b>Cache:</b> ${logData.cacheHit ? "✅ HIT" : "❌ MISS"}`,
  ];

  if (logData.blocked) {
    lines.push(
      `🚫 <b>Blocked:</b> Yes — ${escapeHtml(logData.blockReason)}`
    );
  }

  if (logData.resolvedUrl && logData.resolvedUrl !== logData.facebookUrl) {
    lines.push(
      `🔀 <b>Resolved:</b> <code>${escapeHtml(logData.resolvedUrl)}</code>`
    );
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (error) {
    console.error("Failed to send Telegram log:", error);
  }
}

// ===== Blocklist =====

function globToRegex(pattern) {
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1");
  const regexStr = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regexStr}$`, "i");
}

function matchBlockPattern(pattern, url) {
  try {
    const parsed = new URL(url);
    const hostAndPath = parsed.hostname + parsed.pathname;

    // Pattern without "/" => match domain only
    if (!pattern.includes("/")) {
      return globToRegex(pattern).test(parsed.hostname);
    }

    return globToRegex(pattern).test(hostAndPath);
  } catch {
    return false;
  }
}

async function isBlocked(env, url) {
  try {
    const index = await env.BLOCKLIST.get("index", { type: "json" });
    if (!Array.isArray(index) || index.length === 0) {
      return { blocked: false, reason: "" };
    }

    for (const ruleId of index) {
      const rule = await env.BLOCKLIST.get(`rule:${ruleId}`, {
        type: "json",
      });
      if (!rule) continue;

      if (matchBlockPattern(rule.pattern, url)) {
        return { blocked: true, reason: rule.reason || "Policy violation" };
      }
    }
  } catch (error) {
    console.error("Error checking blocklist:", error);
  }

  return { blocked: false, reason: "" };
}

function generateBlockedPage(url, reason) {
  const safeUrl = escapeHtml(url);
  const safeReason = escapeHtml(reason);

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>連結已被封鎖 — Facebook 分享連結預覽好幫手</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC&display=swap');
    * { font-family: "Heiti TC", "Noto Sans TC", sans-serif; }
    body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; }
    .blocked { background: #fff; border-radius: 12px; padding: 40px; max-width: 500px; text-align: center; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .blocked h1 { color: #dc3545; font-size: 1.5em; }
    .blocked .reason { color: #666; margin: 16px 0; }
    .blocked .url { color: #999; font-size: 0.85em; word-break: break-all; }
  </style>
</head>
<body>
  <div class="blocked">
    <h1>🚫 此連結已被封鎖</h1>
    <p class="reason">原因：${safeReason}</p>
    <p class="url">${safeUrl}</p>
  </div>
</body>
</html>`;
}

// ===== Telegram Bot Webhook (Blocklist Management) =====

function isAdminUser(env, userId) {
  const adminIds = (env.TELEGRAM_ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return adminIds.includes(String(userId));
}

async function sendTelegramReply(env, chatId, text, replyToMessageId) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_to_message_id: replyToMessageId,
        disable_web_page_preview: true,
      }),
    });
  } catch (error) {
    console.error("Failed to send Telegram reply:", error);
  }
}

async function handleBotCommand(env, message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const messageId = message.message_id;
  const text = (message.text || "").trim();

  // Only process commands (starts with /)
  if (!text.startsWith("/")) return;

  // Parse command and arguments (handle @botname suffix)
  const parts = text.split(/\s+/);
  const command = parts[0].split("@")[0].toLowerCase();
  const args = parts.slice(1);

  if (command === "/help") {
    const helpText = [
      "🔧 <b>封鎖清單管理指令</b>",
      "",
      "/block <code>&lt;pattern&gt;</code> [reason]",
      "  新增封鎖規則（支援 domain + path glob）",
      "  範例：<code>/block *.example.com 違反政策</code>",
      "  範例：<code>/block example.com/path/* spam</code>",
      "",
      "/unblock <code>&lt;rule_id&gt;</code>",
      "  刪除指定封鎖規則",
      "",
      "/list",
      "  列出所有封鎖規則",
      "",
      "/help",
      "  顯示此說明",
    ].join("\n");
    await sendTelegramReply(env, chatId, helpText, messageId);
    return;
  }

  // All management commands require admin
  if (!isAdminUser(env, userId)) {
    await sendTelegramReply(
      env,
      chatId,
      "⛔ 你沒有權限執行此操作。",
      messageId
    );
    return;
  }

  if (command === "/block") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/block &lt;pattern&gt; [reason]</code>",
        messageId
      );
      return;
    }

    const pattern = args[0];
    const reason = args.slice(1).join(" ") || "Policy violation";
    const ruleId = crypto.randomUUID();
    const rule = {
      id: ruleId,
      pattern,
      type: "domain_path",
      reason,
      createdAt: new Date().toISOString(),
      createdBy: userId,
    };

    await env.BLOCKLIST.put(`rule:${ruleId}`, JSON.stringify(rule));
    const index =
      (await env.BLOCKLIST.get("index", { type: "json" })) || [];
    index.push(ruleId);
    await env.BLOCKLIST.put("index", JSON.stringify(index));

    const reply = [
      "✅ <b>封鎖規則已新增</b>",
      "",
      `📝 <b>Pattern:</b> <code>${escapeHtml(pattern)}</code>`,
      `📄 <b>Reason:</b> ${escapeHtml(reason)}`,
      `🆔 <b>Rule ID:</b> <code>${ruleId}</code>`,
    ].join("\n");
    await sendTelegramReply(env, chatId, reply, messageId);
    return;
  }

  if (command === "/unblock") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/unblock &lt;rule_id&gt;</code>",
        messageId
      );
      return;
    }

    const ruleId = args[0];
    const existing = await env.BLOCKLIST.get(`rule:${ruleId}`, {
      type: "json",
    });
    if (!existing) {
      await sendTelegramReply(
        env,
        chatId,
        `❌ 找不到規則 <code>${escapeHtml(ruleId)}</code>`,
        messageId
      );
      return;
    }

    const index =
      (await env.BLOCKLIST.get("index", { type: "json" })) || [];
    const newIndex = index.filter((id) => id !== ruleId);
    await env.BLOCKLIST.put("index", JSON.stringify(newIndex));
    await env.BLOCKLIST.delete(`rule:${ruleId}`);

    const reply = [
      "🗑️ <b>封鎖規則已刪除</b>",
      "",
      `📝 <b>Pattern:</b> <code>${escapeHtml(existing.pattern)}</code>`,
      `🆔 <b>Rule ID:</b> <code>${escapeHtml(ruleId)}</code>`,
    ].join("\n");
    await sendTelegramReply(env, chatId, reply, messageId);
    return;
  }

  if (command === "/list") {
    const index =
      (await env.BLOCKLIST.get("index", { type: "json" })) || [];
    if (index.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "📋 封鎖清單目前是空的。",
        messageId
      );
      return;
    }

    const lines = ["📋 <b>封鎖清單</b>", ""];
    for (const ruleId of index) {
      const rule = await env.BLOCKLIST.get(`rule:${ruleId}`, {
        type: "json",
      });
      if (!rule) continue;
      lines.push(
        `• <code>${escapeHtml(rule.pattern)}</code>`,
        `  原因：${escapeHtml(rule.reason)}`,
        `  ID：<code>${escapeHtml(rule.id)}</code>`,
        ""
      );
    }
    await sendTelegramReply(env, chatId, lines.join("\n"), messageId);
    return;
  }
}

async function handleTelegramWebhook(request, env) {
  // Verify webhook secret
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  // Process message with bot commands
  if (update.message) {
    await handleBotCommand(env, update.message);
  }

  // Always return 200 to Telegram to acknowledge receipt
  return new Response("OK", { status: 200 });
}

// ===== Metadata Fetching =====

async function fetchMetadata(env, url) {
  // Check cache first
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
        html.match(
          new RegExp(`<meta property="${prop}" content="([^"]*)"`, "i")
        ) ||
        html.match(
          new RegExp(`<meta name="${prop}" content="([^"]*)"`, "i")
        ) ||
        html.match(
          new RegExp(`<meta property="${prop}" content='([^']*)'`, "i")
        );
      return match ? match[1] : null;
    };

    const title = getMeta("og:title") || getMeta("title") || "";
    const description =
      getMeta("og:description") || getMeta("description") || "";
    const image = getMeta("og:image") || "";
    const site_name = getMeta("og:site_name") || "";
    const urlFromMeta = getMeta("og:url") || url;

    const metadata = {
      og: { title, description, image, url: urlFromMeta, site_name },
      meta: { title, description, url: urlFromMeta },
    };

    // Cache successful results
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

// ===== HTML Generation =====

function generateHtmlWithMetadata(metadata, url) {
  const processedUrl = metadata.meta.url ?? metadata.og.url ?? url;

  // Escape dynamic metadata for safe HTML embedding
  const safeTitle = escapeHtml(metadata.og.title);
  const safeDesc = escapeHtml(metadata.og.description ?? "");
  const safeImg = escapeHtml(metadata.og.image || "/og.jpg");
  const safeOgUrl = escapeHtml(metadata.og.url);
  const safeProcessedUrl = escapeHtml(processedUrl);
  const safeDecodedUrl = escapeHtml(safeDecodeURI(processedUrl));

  const titleHtml = `${safeTitle} &#128588; Facebook 分享連結預覽好幫手`;
  const descHtml = `${safeDesc}${metadata.og.description != null ? " - " : ""}${safeTitle}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${titleHtml}</title>
  <meta name="title" content="${titleHtml}" />
  <meta name="description" content="${descHtml}" />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${safeOgUrl}" />
  <meta property="og:site_name" content="${titleHtml}" />
  <meta property="og:title" content="${titleHtml}" />
  <meta property="og:description" content="${descHtml}" />
  <meta property="og:image" content="${safeImg}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${safeOgUrl}" />
  <meta name="twitter:title" content="${titleHtml}" />
  <meta name="twitter:description" content="${descHtml}" />
  <meta name="twitter:image" content="${safeImg}" />

  <!-- Telegram -->
  <meta property="og:image" content="${safeImg}" />
  <meta property="telegram_channel" content="turbolabit">

  <!-- Redirect to Facebook -->
  <meta http-equiv="refresh" content="2; url=${safeProcessedUrl}" />

  <style>
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC&display=swap');
    * {
      font-family: "Heiti TC", "Noto Sans TC", sans-serif;
    }
    .message {
      margin: 20px 10px;
    }
    .message a {
      background: #0D5C33;
      padding: 4px 10px;
      color: #FFF;
      border-radius: 15px;
      text-decoration: none;
    }
    .message a:hover, .message a:active {
      color: #FFF;
      text-decoration: none;
    }
    .message a::before {
      content: "🔗 ";
    }
  </style>

</head>
<body>
  <div class="message">
    Facebook 分享連結預覽好幫手 🙌 正在帶您前往 <a href="${safeProcessedUrl}">${safeDecodedUrl}</a>。
  </div>
</body>
</html>`;
}

function generateLandingPage() {
  const title = "Facebook 分享連結預覽好幫手 🙌";
  const description = "分享 Facebook 連結有預覽資訊的神奇魔法！✨";
  const img = "/og.jpg";
  const url = "/";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${title}</title>
  <meta name="title" content="${title}" />
  <meta name="description" content="${description}" />

  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${url}" />
  <meta property="og:site_name" content="${title}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:image" content="${img}" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:url" content="${url}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${img}" />

  <!-- Telegram -->
  <meta property="og:image" content="${img}" />
  <meta property="telegram_channel" content="turbolabit">

  <!-- Redirect to GitHub -->
  <meta http-equiv="refresh" content="0; url=https://github.com/allen0099/CF-test" />
</head>
<body></body>
</html>`;
}

// ===== Route Matching =====

function matchRoute(pathname) {
  if (pathname === "/favicon.ico") {
    return { route: "favicon" };
  }

  if (pathname === "/webhook/telegram") {
    return { route: "telegram-webhook" };
  }

  if (pathname === "/") {
    return { route: "landing" };
  }

  const shareTypeMatch = pathname.match(/^\/share\/([^/]+)\/([^/]+)$/);
  if (shareTypeMatch) {
    return { route: "share-type", type: shareTypeMatch[1], id: shareTypeMatch[2] };
  }

  const shareMatch = pathname.match(/^\/share\/([^/]+)$/);
  if (shareMatch) {
    return { route: "share", id: shareMatch[1] };
  }

  const userPostMatch = pathname.match(/^\/([^/]+)\/posts\/([^/]+)$/);
  if (userPostMatch) {
    return { route: "user-post", username: userPostMatch[1], id: userPostMatch[2] };
  }

  const catchAllMatch = pathname.match(/^\/([^/]+)$/);
  if (catchAllMatch) {
    return { route: "catch-all", id: catchAllMatch[1] };
  }

  return { route: "not-found" };
}

// ===== Link Request Handler =====

async function handleLinkRequest(request, env, executionCtx, facebookUrl) {
  const visitorIp = request.headers.get("cf-connecting-ip") || "unknown";
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

// ===== Main Worker Export =====

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const matched = matchRoute(pathname);

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
        const fbUrl = `https://www.facebook.com/share/${matched.id}`;
        return handleLinkRequest(request, env, ctx, fbUrl);
      }

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};
