import { escapeHtml, safeDecodeURI } from "./utils.js";

export function generateHtmlWithMetadata(metadata, url) {
  const processedUrl = metadata.meta.url ?? metadata.og.url ?? url;

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

export function generateLandingPage() {
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
