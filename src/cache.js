import { hashUrl } from "./utils.js";

export async function cacheGet(env, url) {
  const key = await hashUrl(url);
  return env.METADATA_CACHE.get(key, { type: "json" });
}

export async function cachePut(env, url, metadata, ttl) {
  const key = await hashUrl(url);
  await env.METADATA_CACHE.put(key, JSON.stringify(metadata), {
    expirationTtl: ttl,
  });
}
