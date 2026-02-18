
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

function safeDecodeURIComponent(component) {
  try {
    return decodeURIComponent(component);
  } catch {
    return component;
  }
}

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
function resolveLoginRedirect(loginUrl, fallbackUrl) {
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

    // If nothing matched, fall back
    console.warn("[LoginResolve] Could not extract usable destination from 'next' URL, falling back to original URL");
    return fallbackUrl;
  } catch (error) {
    console.error("[LoginResolve] Error resolving login redirect:", error);
    return fallbackUrl;
  }
}

// Decode HTML entities (&#xHEX;, &#DECIMAL;, and common named entities)
function decodeHtmlEntities(str) {
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

// Extract the first Facebook URL from a text message
function extractFacebookUrl(text) {
  const pattern = /https?:\/\/(?:www\.)?(?:facebook\.com|fb\.com|m\.facebook\.com|web\.facebook\.com)\/\S+/i;
  const match = text.match(pattern);
  return match ? match[0] : null;
}

// Convert a Facebook URL to a Worker preview URL
function facebookUrlToWorkerUrl(baseUrl, facebookUrl) {
  try {
    const parsed = new URL(facebookUrl);
    const base = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
    return base + parsed.pathname;
  } catch {
    return null;
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
    `🏢 <b>AS Org:</b> ${escapeHtml(logData.asOrganization || "N/A")}`,
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
    const payload = {
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    if (env.TELEGRAM_THREAD_ID) {
      payload.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
    }
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
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

// ===== AS Organization Blocklist =====

async function isAsOrgBlocked(env, asOrganization) {
  if (!asOrganization) return { blocked: false, reason: "" };

  try {
    const index = await env.BLOCKLIST.get("as_org_index", { type: "json" });
    if (!Array.isArray(index) || index.length === 0) {
      return { blocked: false, reason: "" };
    }

    const normalizedOrg = asOrganization.toLowerCase();
    for (const entry of index) {
      if (normalizedOrg === entry.pattern.toLowerCase()) {
        return { blocked: true, reason: entry.reason || "Blocked AS Organization" };
      }
    }
  } catch (error) {
    console.error("Error checking AS org blocklist:", error);
  }

  return { blocked: false, reason: "" };
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

async function sendTelegramReply(env, chatId, text, replyToMessageId, chatType, options = {}) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    const payload = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_to_message_id: replyToMessageId,
      disable_web_page_preview: options.disableWebPagePreview !== undefined ? options.disableWebPagePreview : true,
    };
    // Only set thread ID for group/supergroup chats, not private chats
    if (env.TELEGRAM_THREAD_ID && chatType !== "private") {
      payload.message_thread_id = Number(env.TELEGRAM_THREAD_ID);
    }
    const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[Bot] sendMessage failed (${resp.status}):`, body);
    }
  } catch (error) {
    console.error("Failed to send Telegram reply:", error);
  }
}

async function handleBotCommand(env, message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const messageId = message.message_id;
  const chatType = message.chat?.type;
  const text = (message.text || "").trim();

  console.log(`[Bot] Message from user ${userId} in chat ${chatId} (${chatType}): ${text}`);

  // Handle non-command messages: parse Facebook links in private chats
  if (!text.startsWith("/")) {
    if (chatType === "private") {
      await handlePrivateLinkParsing(env, message);
    } else {
      console.log("[Bot] Not a command in non-private chat, skipping");
    }
    return;
  }

  // Parse command and arguments (handle @botname suffix)
  const parts = text.split(/\s+/);
  const command = parts[0].split("@")[0].toLowerCase();
  const args = parts.slice(1);

  console.log(`[Bot] Parsed command: ${command}, args: [${args.join(", ")}]`);

  if (command === "/help") {
    const helpText = [
      "🔧 <b>封鎖清單管理指令</b>",
      "",
      "<b>連結封鎖：</b>",
      "/block <code>&lt;pattern&gt;</code> [reason]",
      "  新增封鎖規則（支援 domain + path glob）",
      "  範例：<code>/block *.example.com 違反政策</code>",
      "  範例：<code>/block example.com/path/* spam</code>",
      "",
      "/unblock <code>&lt;rule_id&gt;</code>",
      "  刪除指定封鎖規則",
      "",
      "/list",
      "  列出所有連結封鎖規則",
      "",
      "<b>AS Organization 封鎖：</b>",
      "/block_org <code>&lt;name&gt;</code> [reason]",
      "  封鎖特定 AS Organization 來源",
      "  範例：<code>/block_org Cloudflare bot traffic</code>",
      "",
      "/unblock_org <code>&lt;name&gt;</code>",
      "  解除 AS Organization 封鎖",
      "",
      "/list_org",
      "  列出所有 AS Organization 封鎖規則",
      "",
      "/help",
      "  顯示此說明",
    ].join("\n");
    await sendTelegramReply(env, chatId, helpText, messageId, chatType);
    return;
  }

  // All management commands require admin
  if (!isAdminUser(env, userId)) {
    await sendTelegramReply(
      env,
      chatId,
      "⛔ 你沒有權限執行此操作。",
      messageId,
      chatType
    );
    return;
  }

  if (command === "/block") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/block &lt;pattern&gt; [reason]</code>",
        messageId,
        chatType
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
    await sendTelegramReply(env, chatId, reply, messageId, chatType);
    return;
  }

  if (command === "/unblock") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/unblock &lt;rule_id&gt;</code>",
        messageId,
        chatType
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
        messageId,
        chatType
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
    await sendTelegramReply(env, chatId, reply, messageId, chatType);
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
        messageId,
        chatType
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
    await sendTelegramReply(env, chatId, lines.join("\n"), messageId, chatType);
    return;
  }

  if (command === "/block_org") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/block_org &lt;name&gt; [reason]</code>",
        messageId,
        chatType
      );
      return;
    }

    const orgName = args[0];
    const reason = args.slice(1).join(" ") || "Blocked AS Organization";

    const index =
      (await env.BLOCKLIST.get("as_org_index", { type: "json" })) || [];

    // Check for duplicate
    if (index.some((e) => e.pattern.toLowerCase() === orgName.toLowerCase())) {
      await sendTelegramReply(
        env,
        chatId,
        `⚠️ <code>${escapeHtml(orgName)}</code> 已在封鎖清單中。`,
        messageId,
        chatType
      );
      return;
    }

    index.push({
      pattern: orgName,
      reason,
      createdAt: new Date().toISOString(),
      createdBy: userId,
    });
    await env.BLOCKLIST.put("as_org_index", JSON.stringify(index));

    const reply = [
      "✅ <b>AS Organization 封鎖已新增</b>",
      "",
      `🏢 <b>Name:</b> <code>${escapeHtml(orgName)}</code>`,
      `📄 <b>Reason:</b> ${escapeHtml(reason)}`,
    ].join("\n");
    await sendTelegramReply(env, chatId, reply, messageId, chatType);
    return;
  }

  if (command === "/unblock_org") {
    if (args.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "⚠️ 用法：<code>/unblock_org &lt;name&gt;</code>",
        messageId,
        chatType
      );
      return;
    }

    const orgName = args.join(" ");
    const index =
      (await env.BLOCKLIST.get("as_org_index", { type: "json" })) || [];
    const newIndex = index.filter(
      (e) => e.pattern.toLowerCase() !== orgName.toLowerCase()
    );

    if (newIndex.length === index.length) {
      await sendTelegramReply(
        env,
        chatId,
        `❌ 找不到 AS Organization <code>${escapeHtml(orgName)}</code>`,
        messageId,
        chatType
      );
      return;
    }

    await env.BLOCKLIST.put("as_org_index", JSON.stringify(newIndex));

    const reply = [
      "🗑️ <b>AS Organization 封鎖已解除</b>",
      "",
      `🏢 <b>Name:</b> <code>${escapeHtml(orgName)}</code>`,
    ].join("\n");
    await sendTelegramReply(env, chatId, reply, messageId, chatType);
    return;
  }

  if (command === "/list_org") {
    const index =
      (await env.BLOCKLIST.get("as_org_index", { type: "json" })) || [];
    if (index.length === 0) {
      await sendTelegramReply(
        env,
        chatId,
        "📋 AS Organization 封鎖清單目前是空的。",
        messageId,
        chatType
      );
      return;
    }

    const lines = ["📋 <b>AS Organization 封鎖清單</b>", ""];
    for (const entry of index) {
      lines.push(
        `• <code>${escapeHtml(entry.pattern)}</code>`,
        `  原因：${escapeHtml(entry.reason)}`,
        ""
      );
    }
    await sendTelegramReply(env, chatId, lines.join("\n"), messageId, chatType);
    return;
  }
}

async function handlePrivateLinkParsing(env, message) {
  const chatId = message.chat.id;
  const userId = message.from?.id;
  const messageId = message.message_id;
  const text = (message.text || "").trim();

  const facebookUrl = extractFacebookUrl(text);
  if (!facebookUrl) {
    console.log(`[Bot] No Facebook URL found in private message from user ${userId}`);
    return;
  }

  console.log(`[Bot] Private link parsing for user ${userId}: ${facebookUrl}`);

  // Check blocklist
  const blockResult = await isBlocked(env, facebookUrl);
  if (blockResult.blocked) {
    console.log(`[Bot] URL blocked: ${facebookUrl} — ${blockResult.reason}`);
    await sendTelegramReply(
      env,
      chatId,
      `🚫 此連結已被封鎖\n原因：${escapeHtml(blockResult.reason)}`,
      messageId,
      "private"
    );
    return;
  }

  // Fetch metadata
  const metadata = await fetchMetadata(env, facebookUrl);
  const cacheHit = metadata._cacheHit;
  const resolvedUrl = metadata.meta.url ?? metadata.og.url ?? facebookUrl;

  console.log(`[Bot] Metadata fetched for ${facebookUrl} (cache: ${cacheHit ? "HIT" : "MISS"})`);

  // Check blocklist against resolved URL
  if (resolvedUrl !== facebookUrl) {
    const resolvedBlock = await isBlocked(env, resolvedUrl);
    if (resolvedBlock.blocked) {
      console.log(`[Bot] Resolved URL blocked: ${resolvedUrl} — ${resolvedBlock.reason}`);
      await sendTelegramReply(
        env,
        chatId,
        `🚫 此連結已被封鎖\n原因：${escapeHtml(resolvedBlock.reason)}`,
        messageId,
        "private"
      );
      return;
    }
  }

  // Build reply
  const title = metadata.og.title || "";
  const description = metadata.og.description || "";
  const truncatedDesc = description.length > 200 ? description.slice(0, 200) + "…" : description;

  const lines = [];

  if (title) {
    lines.push(`<b>${escapeHtml(title)}</b>`);
  }
  if (truncatedDesc) {
    lines.push(`${escapeHtml(truncatedDesc)}`);
  }

  lines.push("");
  lines.push(`🔗 <b><a href="${escapeHtml(resolvedUrl)}">原始連結</a></b>`);

  // Worker preview link (if WORKER_BASE_URL is configured)
  const baseUrl = env.WORKER_BASE_URL;
  if (baseUrl) {
    const workerUrl = facebookUrlToWorkerUrl(baseUrl, resolvedUrl);
    if (workerUrl) {
      lines.push("");
      lines.push(`🌐 <b>預覽連結：</b>`);
      lines.push(`<code>${escapeHtml(workerUrl)}</code>`);
    }
  }

  await sendTelegramReply(env, chatId, lines.join("\n"), messageId, "private", {
    disableWebPagePreview: false,
  });

  // Send log to Telegram log channel
  const timestamp = new Date().toISOString();
  await sendTelegramLog(env, {
    facebookUrl,
    visitorIp: `Telegram user ${userId}`,
    timestamp,
    asOrganization: "Telegram Private Chat",
    cacheHit,
    blocked: false,
    resolvedUrl,
  });
}

async function handleTelegramWebhook(request, env) {
  // Verify webhook secret
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    console.warn("[Webhook] Unauthorized request — invalid or missing secret");
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    console.error("[Webhook] Failed to parse request body as JSON");
    return new Response("Bad Request", { status: 400 });
  }

  console.log("[Webhook] Received update:", JSON.stringify(update));

  // Process message with bot commands
  if (update.message) {
    await handleBotCommand(env, update.message);
  } else {
    console.log("[Webhook] Update has no message field, skipping");
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
      return match ? decodeHtmlEntities(match[1]) : null;
    };

    const title = getMeta("og:title") || getMeta("title") || "";
    const description =
      getMeta("og:description") || getMeta("description") || "";
    const image = getMeta("og:image") || "";
    const site_name = getMeta("og:site_name") || "";
    let urlFromMeta = getMeta("og:url") || url;

    // If urlFromMeta requires login, resolve the actual destination
    if (urlFromMeta.includes("/login/")) {
      console.warn(`[Metadata] og:url requires login: ${urlFromMeta}`);
      // Can not get the correct URL, skipped
      // urlFromMeta = resolveLoginRedirect(urlFromMeta, url);
      // console.log(`[Metadata] Final resolved URL: ${urlFromMeta}`);
    }

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
    const id = catchAllMatch[1];
    // Skip paths with file extensions (e.g. robots.txt, sitemap.xml, .well-known)
    if (/\.\w{1,10}$/.test(id)) {
      return { route: "not-found" };
    }
    return { route: "catch-all", id };
  }

  return { route: "not-found" };
}

// ===== Link Request Handler =====

async function handleLinkRequest(request, env, executionCtx, facebookUrl) {
  const visitorIp = request.headers.get("cf-connecting-ip") || "unknown";
  const timestamp = new Date().toISOString();
  const cf = request.cf || {};
  const asOrganization = cf.asOrganization || "";

  // Phase 0: Check AS Organization blocklist
  const asOrgBlock = await isAsOrgBlocked(env, asOrganization);
  if (asOrgBlock.blocked) {
    executionCtx.waitUntil(
      sendTelegramLog(env, {
        facebookUrl,
        visitorIp,
        timestamp,
        asOrganization,
        cacheHit: false,
        blocked: true,
        blockReason: `AS Org: ${asOrgBlock.reason}`,
      })
    );
    return htmlResponse(
      generateBlockedPage(facebookUrl, `來源組織 (${asOrganization}) 已被封鎖：${asOrgBlock.reason}`),
      403
    );
  }

  // Phase 1: Check blocklist against input URL
  const inputBlock = await isBlocked(env, facebookUrl);
  if (inputBlock.blocked) {
    executionCtx.waitUntil(
      sendTelegramLog(env, {
        facebookUrl,
        visitorIp,
        timestamp,
        asOrganization,
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
          asOrganization,
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
      asOrganization,
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
        return new Response("Unknown route", { status: 404 });
    }
  },
};
