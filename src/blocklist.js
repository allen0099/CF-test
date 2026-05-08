import { escapeHtml } from "./utils.js";

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

export async function isBlocked(env, url) {
  try {
    const index = await env.BLOCKLIST.get("index", { type: "json" });
    if (!Array.isArray(index) || index.length === 0) {
      return { blocked: false, reason: "" };
    }

    for (const ruleId of index) {
      const rule = await env.BLOCKLIST.get(`rule:${ruleId}`, { type: "json" });
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

export function generateBlockedPage(url, reason) {
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
