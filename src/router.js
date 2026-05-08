export function matchRoute(pathname) {
  if (pathname === "/favicon.ico") {
    return { route: "favicon" };
  }

  if (pathname === "/webhook/telegram") {
    return { route: "telegram-webhook" };
  }

  if (pathname === "/") {
    return { route: "landing" };
  }

  const shareTypeMatch = pathname.match(/^\/share\/([^/]+)\/([^/]+)\/?$/);
  if (shareTypeMatch) {
    return { route: "share-type", type: shareTypeMatch[1], id: shareTypeMatch[2] };
  }

  const shareMatch = pathname.match(/^\/share\/([^/]+)\/?$/);
  if (shareMatch) {
    return { route: "share", id: shareMatch[1] };
  }

  const userPostMatch = pathname.match(/^\/([^/]+)\/posts\/([^/]+)\/?$/);
  if (userPostMatch) {
    return { route: "user-post", username: userPostMatch[1], id: userPostMatch[2] };
  }

  const catchAllMatch = pathname.match(/^\/([^/]+)\/?$/);
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
