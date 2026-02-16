
import Koa from "koa";
import Router from "@koa/router";
import { get } from "koa/lib/response";

import path from "path";
import { httpServerHandler } from "cloudflare:node";

const app = new Koa();
const router = new Router();



// Custom metadata parser for Cloudflare Workers
async function fetchMetadata(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      }
    });

    if (!response.ok) throw new Error(`Failed to fetch ${url}`);

    const html = await response.text();

    const getMeta = (prop) => {
      const match = html.match(new RegExp(`<meta property="${prop}" content="([^"]*)"`, "i")) ||
        html.match(new RegExp(`<meta name="${prop}" content="([^"]*)"`, "i")) ||
        html.match(new RegExp(`<meta property="${prop}" content='([^']*)'`, "i"));
      return match ? match[1] : null;
    };

    const title = getMeta("og:title") || getMeta("title") || "";
    const description = getMeta("og:description") || getMeta("description") || "";
    const image = getMeta("og:image") || "";
    const site_name = getMeta("og:site_name") || "";
    const urlFromMeta = getMeta("og:url") || url;

    return {
      og: { title, description, image, url: urlFromMeta, site_name },
      meta: { title, description, url: urlFromMeta }
    };
  } catch (error) {
    console.error("Error fetching metadata:", error);
    return {
      og: { title: "Error", description: "Could not fetch metadata", image: "", url, site_name: "" },
      meta: { title: "Error", description: "Could not fetch metadata", url }
    };
  }
}

async function generateHtmlWithMetadata(url) {
  const metadata = await fetchMetadata(url);
  console.log("Fetched Metadata:", JSON.stringify(metadata, null, 2));
  const processedUrl = metadata.meta.url ?? metadata.og.url ?? url;
  let title = `${metadata.og.title} &#128588; Facebook 分享連結預覽好幫手`;
  let description = `${metadata.og.description ?? ""}${metadata.og.description != null ? " - " : ""}${metadata.og.title}`;
  let img = metadata.og.image ?? "/og.jpg";
  let html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">

    <title>${title}</title>
    <meta name="title" content="${title}" />
    <meta name="description" content="${description}" />

    <!-- Open Graph / Facebook -->
    <meta property="og:type" content="website" />
    <meta property="og:url" content="${metadata.og.url}" />
    <meta property="og:site_name" content="${title}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:image" content="${img}" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:url" content="${metadata.og.url}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${img}" />

    <!-- Telegram -->
    <meta property="og:image" content="${img}" />
    <meta property="telegram_channel" content="turbolabit">

    <!-- Redirect to Facebook -->
    <meta http-equiv="refresh" content="2; url = ${processedUrl}" />

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
      Facebook 分享連結預覽好幫手 🙌 正在帶您前往 <a href="${processedUrl}">${decodeURI(processedUrl)}</a>。
    </div>
  </body>
  </html>
  `;
  return html;
}

router.get("/favicon.ico", (ctx) => {
  ctx.status = 404;
});

router.get("/", async (ctx, next) => {
  let title = "Facebook 分享連結預覽好幫手 🙌";
  let description = "分享 Facebook 連結有預覽資訊的神奇魔法！✨";
  let img = `/og.jpg`;
  let url = `/`;
  let html = `
  <!DOCTYPE html>
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

    <!-- Redirect to README -->
    <meta http-equiv="refresh" content="0; url = https://github.com/fanlan1210/MetaFacebookFix/blob/main/README.md" />
  </head>
  <body></body>
  </html>
  `;
  ctx.body = html;
  ctx.type = "text/html";
});

router.get("/share/:type/:id", async (ctx, next) => {
  const url = `https://www.facebook.com/share/${ctx.params.type}/${ctx.params.id}`;
  // console.log(ctx.params.id);

  ctx.body = await generateHtmlWithMetadata(url);
  ctx.type = "text/html";
});

router.get("/share/:id", async (ctx, next) => {
  const url = `https://www.facebook.com/share/${ctx.params.id}`;
  // console.log(ctx.params.id);

  ctx.body = await generateHtmlWithMetadata(url);
  ctx.type = "text/html";
});

router.get("/:username/posts/:id", async (ctx, next) => {
  const url = `https://www.facebook.com/${ctx.params.username}/posts/${ctx.params.id}`;
  // console.log(ctx.params.id);

  ctx.body = await generateHtmlWithMetadata(url);
  ctx.type = "text/html";
});

router.get("/:id", async (ctx, next) => {
  const url = `https://www.facebook.com/share/${ctx.params.id}`;
  /* const metadata = await parser(url).then((result) => {
    return result;
  }); */
  ctx.body = await generateHtmlWithMetadata(url);
  ctx.type = "text/html";
});

app.use(router.routes()).use(router.allowedMethods());

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server running on ${process.env.PORT || 3000}\n`);
});

export default httpServerHandler({ port: process.env.PORT || 3000 });
