![](/og.jpg)

# Meta Facebook 分享連結預覽好幫手 🙌

在社群媒體和通訊軟體中分享 Facebook 連結時，自動產生豐富的預覽資訊（Open Graph / Twitter Card / Telegram）的神奇魔法！✨

部署於 **Cloudflare Workers**，透過 KV 快取 metadata、Telegram Bot 管理封鎖清單、每次請求即時推送 Telegram log。

## 功能特色

- 🔗 **連結預覽代理** — 將 Facebook 分享連結轉為帶有 OG meta tags 的頁面，讓各平台正確顯示預覽
- ⚡ **KV 快取** — 解析過的 metadata 存入 Cloudflare KV，避免重複抓取（預設 TTL 1 小時）
- 📋 **Telegram Log** — 每次連結請求自動推送通知至 Telegram（含 URL、訪客 IP、快取狀態、封鎖狀態）
- 🚫 **連結封鎖機制** — 支援 domain + path glob 模式封鎖，違規連結返回 403 頁面
- 🤖 **Telegram Bot 管理** — 透過 Bot 指令管理封鎖清單，支援多管理員
- 🛡️ **XSS 防護** — 所有動態 metadata 皆經過 HTML 轉義

## 如何使用

### 使用方式

將 Facebook 分享連結中的 `https://www.facebook.com` 替換成本服務的 domain 即可。

**支援的連結格式：**

| Facebook 原始連結 | 代理連結 |
|---|---|
| `https://www.facebook.com/share/{type}/{id}` | `https://YOUR_DOMAIN/share/{type}/{id}` |
| `https://www.facebook.com/share/{id}` | `https://YOUR_DOMAIN/share/{id}` |
| `https://www.facebook.com/{username}/posts/{id}` | `https://YOUR_DOMAIN/{username}/posts/{id}` |

訪問代理連結後，爬蟲會看到完整的 OG 預覽，一般使用者則在 2 秒後自動跳轉至原始 Facebook 頁面。

## 部署

### 前置需求

- Node.js
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Cloudflare 帳號
- Telegram Bot（透過 [@BotFather](https://t.me/BotFather) 建立）

### 步驟

1. **建立 KV Namespace**

```bash
npx wrangler kv namespace create METADATA_CACHE
npx wrangler kv namespace create BLOCKLIST
```

將回傳的 `id` 填入 `wrangler.jsonc` 中的 `kv_namespaces`。

2. **設定環境變數**

在 `wrangler.jsonc` 的 `vars` 中設定：

| 變數 | 說明 | 預設值 |
|---|---|---|
| `TELEGRAM_LOG_LEVEL` | Log 層級 | `"all"` |
| `CACHE_TTL` | KV 快取 TTL（秒） | `"3600"` |
| `TELEGRAM_ADMIN_IDS` | 允許管理封鎖清單的 Telegram user ID（逗號分隔） | `""` |

3. **設定 Secrets**

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
```

4. **部署**

```bash
npx wrangler deploy
```

5. **註冊 Telegram Webhook**

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://YOUR_DOMAIN/webhook/telegram&secret_token=<WEBHOOK_SECRET>"
```

### 本機開發

```bash
npx wrangler dev
```

## Telegram Bot 指令

透過 Telegram Bot 管理封鎖清單（需在 `TELEGRAM_ADMIN_IDS` 中的使用者）：

| 指令 | 說明 |
|---|---|
| `/block <pattern> [reason]` | 新增封鎖規則（支援 glob，如 `*.example.com`、`example.com/path/*`） |
| `/unblock <rule_id>` | 刪除指定封鎖規則 |
| `/list` | 列出所有封鎖規則 |
| `/help` | 顯示指令說明 |

## 架構

```
Request → Route Matching → Blocklist Check (input URL)
                              ↓
                        Fetch Metadata (KV Cache → Facebook)
                              ↓
                        Blocklist Check (resolved og:url)
                              ↓
                        Generate HTML (escaped OG/Twitter/Telegram meta)
                              ↓
                        Response + Telegram Log (async, non-blocking)
```

## License

[MIT License](LICENSE)
