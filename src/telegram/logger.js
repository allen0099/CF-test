import { escapeHtml } from "../utils.js";

export async function sendTelegramLog(env, logData) {
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
    lines.push(`🚫 <b>Blocked:</b> Yes — ${escapeHtml(logData.blockReason)}`);
  }

  if (logData.resolvedUrl && logData.resolvedUrl !== logData.facebookUrl) {
    lines.push(`🔀 <b>Resolved:</b> <code>${escapeHtml(logData.resolvedUrl)}</code>`);
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
