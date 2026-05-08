import { escapeHtml } from "../utils.js";

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
      disable_web_page_preview: options.disableWebPagePreview !== undefined
        ? options.disableWebPagePreview
        : true,
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

  // Ignore non-command messages
  if (!text.startsWith("/")) {
    console.log("[Bot] Not a command, skipping");
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
      "/help",
      "  顯示此說明",
    ].join("\n");
    await sendTelegramReply(env, chatId, helpText, messageId, chatType);
    return;
  }

  // All management commands require admin
  if (!isAdminUser(env, userId)) {
    await sendTelegramReply(env, chatId, "⛔ 你沒有權限執行此操作。", messageId, chatType);
    return;
  }

  if (command === "/block") {
    if (args.length === 0) {
      await sendTelegramReply(
        env, chatId,
        "⚠️ 用法：<code>/block &lt;pattern&gt; [reason]</code>",
        messageId, chatType
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
    const index = (await env.BLOCKLIST.get("index", { type: "json" })) || [];
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
        env, chatId,
        "⚠️ 用法：<code>/unblock &lt;rule_id&gt;</code>",
        messageId, chatType
      );
      return;
    }

    const ruleId = args[0];
    const existing = await env.BLOCKLIST.get(`rule:${ruleId}`, { type: "json" });
    if (!existing) {
      await sendTelegramReply(
        env, chatId,
        `❌ 找不到規則 <code>${escapeHtml(ruleId)}</code>`,
        messageId, chatType
      );
      return;
    }

    const index = (await env.BLOCKLIST.get("index", { type: "json" })) || [];
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
    const index = (await env.BLOCKLIST.get("index", { type: "json" })) || [];
    if (index.length === 0) {
      await sendTelegramReply(env, chatId, "📋 封鎖清單目前是空的。", messageId, chatType);
      return;
    }

    const lines = ["📋 <b>封鎖清單</b>", ""];
    for (const ruleId of index) {
      const rule = await env.BLOCKLIST.get(`rule:${ruleId}`, { type: "json" });
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
}

export async function handleTelegramWebhook(request, env) {
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
