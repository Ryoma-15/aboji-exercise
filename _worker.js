const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_FRIENDSHIP_URL = "https://api.line.me/friendship/v1/status";
const YOUTUBE_PLAYLIST_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const PLAYLIST_CACHE_SECONDS = 900;
const MAX_PLAYLIST_PAGES = 10;
const VIDEO_COOKIE_NAME = "__Host-aboji_video_access";
const VIDEO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

const SERIES = [
  { key: "tutorial", title: "チュートリアル", envKey: "YT_PLAYLIST_TUTORIAL" },
  { key: "short", title: "短縮版", envKey: "YT_PLAYLIST_SHORT" },
  { key: "message", title: "文平来先生からのメッセージ", envKey: "YT_PLAYLIST_MESSAGE" }
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match && match[1].length <= 4096 ? match[1] : "";
}

function getAccessMode(env) {
  return String(env.VIDEO_ACCESS_MODE || "link").trim().toLowerCase() === "line" ? "line" : "link";
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return "";
}

function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function signValue(secret, value) {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(signature));
}

function safeStringEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

async function createAccessCookie(secret) {
  const expiresAt = Math.floor(Date.now() / 1000) + VIDEO_COOKIE_MAX_AGE;
  const payload = `v1.${expiresAt}`;
  const signature = await signValue(secret, payload);
  return `${payload}.${signature}`;
}

async function hasValidAccessCookie(request, secret) {
  const cookie = getCookie(request, VIDEO_COOKIE_NAME);
  const parts = cookie.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expected = await signValue(secret, payload);
  return safeStringEqual(parts[2], expected);
}

async function matchesEntryToken(candidate, secret) {
  if (!candidate || !secret || candidate.length > 512) return false;
  const encoder = new TextEncoder();
  const [candidateHash, secretHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(candidate)),
    crypto.subtle.digest("SHA-256", encoder.encode(secret))
  ]);
  const left = new Uint8Array(candidateHash);
  const right = new Uint8Array(secretHash);
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function accessDeniedPage(status = 403) {
  const title = status === 503 ? "動画ページを準備しています" : "公式LINEからお入りください";
  const copy = status === 503
    ? "限定動画ページの公開設定がまだ完了していません。"
    : "このページは、朝6アボジ体操公式LINEのリッチメニューからご利用いただけます。";
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${title}｜アボジ体操</title><style>*{box-sizing:border-box}body{margin:0;min-height:100svh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 50% 38%,#17465e 0,#0a2639 34%,#061724 72%);color:#fff;font-family:"Hiragino Maru Gothic ProN","Yu Gothic",sans-serif}.card{width:min(100%,620px);padding:48px 30px;border:1px solid rgba(223,198,142,.45);background:rgba(6,23,36,.76);text-align:center;box-shadow:0 30px 90px rgba(0,0,0,.3)}.orb{width:84px;height:84px;margin:0 auto 25px;border:1px solid #dfc68e;border-radius:50%;box-shadow:0 0 35px rgba(101,200,224,.3),inset 0 0 25px rgba(255,255,255,.08)}.kicker{color:#dfc68e;font-size:11px;letter-spacing:.18em}h1{margin:12px 0 15px;font-family:"Yu Mincho","Hiragino Mincho ProN",serif;font-size:clamp(30px,7vw,46px);font-weight:500;line-height:1.45}p{margin:0;color:#cbd7dd;line-height:1.9;font-size:14px}</style></head><body><main class="card"><div class="orb"></div><div class="kicker">MEMBERS VIDEO LIBRARY</div><h1>${title}</h1><p>${copy}</p></main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function handleVideoPage(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ message: "Method Not Allowed" }, 405);
  if (getAccessMode(env) === "line") return env.ASSETS.fetch(request);

  const secret = String(env.VIDEO_ACCESS_TOKEN || "").trim();
  if (!secret) return accessDeniedPage(503);
  const url = new URL(request.url);
  const entry = url.searchParams.get("entry") || "";
  if (await matchesEntryToken(entry, secret)) {
    const cookie = await createAccessCookie(secret);
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/videos",
        "Set-Cookie": `${VIDEO_COOKIE_NAME}=${cookie}; Max-Age=${VIDEO_COOKIE_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`,
        "Cache-Control": "private, no-store, max-age=0",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      }
    });
  }
  if (!await hasValidAccessCookie(request, secret)) return accessDeniedPage(403);

  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/videos";
  assetUrl.search = "";
  return env.ASSETS.fetch(new Request(assetUrl, { method: request.method, headers: request.headers }));
}

function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

async function verifyLineAccessToken(token, expectedChannelId) {
  const url = new URL(LINE_VERIFY_URL);
  url.searchParams.set("access_token", token);
  const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
  if (!response.ok) return false;
  const result = await response.json();
  const scopes = String(result.scope || "").split(/\s+/);
  return String(result.client_id) === String(expectedChannelId)
    && scopes.includes("profile")
    && Number.isFinite(Number(result.expires_in))
    && Number(result.expires_in) > 0;
}

async function isOfficialAccountFriend(token) {
  const response = await fetch(LINE_FRIENDSHIP_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }
  });
  if (!response.ok) return false;
  const result = await response.json();
  return result.friendFlag === true;
}

function selectThumbnail(thumbnails = {}) {
  const candidates = [thumbnails.medium, thumbnails.high, thumbnails.standard, thumbnails.default];
  const url = candidates.find(item => item && typeof item.url === "string")?.url || "";
  return /^https:\/\/(i\.ytimg\.com|img\.youtube\.com)\//.test(url) ? url : "";
}

function normalizeItems(items) {
  return items.flatMap((item, fallbackIndex) => {
    const videoId = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId;
    const title = String(item?.snippet?.title || "").trim();
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId || "")) return [];
    if (!title || title === "Private video" || title === "Deleted video") return [];
    const position = Number(item?.snippet?.position);
    return [{
      id: videoId,
      title,
      thumbnail: selectThumbnail(item.snippet?.thumbnails),
      playlistIndex: Number.isInteger(position) && position >= 0 ? position : fallbackIndex
    }];
  });
}

async function readCache(playlistId) {
  if (!globalThis.caches?.default) return null;
  try {
    const cacheKey = new Request(`https://playlist-cache.aboji.invalid/v1/${encodeURIComponent(playlistId)}`);
    const cached = await caches.default.match(cacheKey);
    return cached ? await cached.json() : null;
  } catch (_) {
    return null;
  }
}

async function writeCache(context, playlistId, items) {
  if (!globalThis.caches?.default) return;
  try {
    const cacheKey = new Request(`https://playlist-cache.aboji.invalid/v1/${encodeURIComponent(playlistId)}`);
    const cachedResponse = new Response(JSON.stringify(items), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${PLAYLIST_CACHE_SECONDS}`
      }
    });
    context.waitUntil(caches.default.put(cacheKey, cachedResponse));
  } catch (_) {
    // A cache failure must not prevent authenticated playback.
  }
}

async function fetchPlaylistItems(context, playlistId, apiKey) {
  const cached = await readCache(playlistId);
  if (Array.isArray(cached)) return cached;

  const collected = [];
  let pageToken = "";
  for (let page = 0; page < MAX_PLAYLIST_PAGES; page += 1) {
    const url = new URL(YOUTUBE_PLAYLIST_URL);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("key", apiKey);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    if (!response.ok) {
      const error = new Error("YouTube playlist request failed");
      error.status = response.status;
      throw error;
    }
    const result = await response.json();
    collected.push(...normalizeItems(Array.isArray(result.items) ? result.items : []));
    pageToken = result.nextPageToken || "";
    if (!pageToken) break;
  }
  await writeCache(context, playlistId, collected);
  return collected;
}

function loadSettings(env) {
  const apiKey = String(env.YOUTUBE_API_KEY || "").trim();
  const series = SERIES.map(item => ({
    key: item.key,
    title: item.title,
    playlistId: String(env[item.envKey] || "").trim()
  }));
  return apiKey && series.every(item => item.playlistId)
    ? { channelId: String(env.LINE_LOGIN_CHANNEL_ID || "").trim(), apiKey, series }
    : null;
}

async function handleConfig(request, env) {
  if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
  return json({
    accessMode: getAccessMode(env),
    liffId: env.LIFF_ID || "",
    lineAddFriendUrl: env.LINE_ADD_FRIEND_URL || "https://lin.ee/XZ9COtS"
  });
}

async function handleVideos(request, env, context) {
  if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
  if (!isSameOrigin(request)) return json({ message: "許可されていないアクセスです。" }, 403);
  const settings = loadSettings(env);
  if (!settings) return json({ message: "動画ページの設定が完了していません。" }, 503);

  try {
    if (getAccessMode(env) === "link") {
      const secret = String(env.VIDEO_ACCESS_TOKEN || "").trim();
      if (!secret || !await hasValidAccessCookie(request, secret)) {
        return json({ message: "公式LINEのリッチメニューから開いてください。" }, 403);
      }
    } else {
      const token = getBearerToken(request);
      if (!token) return json({ message: "LINEでログインしてください。" }, 401);
      if (!settings.channelId || !await verifyLineAccessToken(token, settings.channelId)) {
        return json({ message: "LINE認証を確認できませんでした。" }, 401);
      }
      if (!await isOfficialAccountFriend(token)) {
        return json({ message: "このページはアボジ体操公式LINE登録者限定です。" }, 403);
      }
    }
    const series = await Promise.all(settings.series.map(async item => ({
      ...item,
      items: await fetchPlaylistItems(context, item.playlistId, settings.apiKey)
    })));
    return json({ series, refreshedWithinSeconds: PLAYLIST_CACHE_SECONDS });
  } catch (error) {
    if (error?.status === 403) return json({ message: "YouTube動画の取得権限を確認してください。" }, 502);
    if (error?.status === 429) return json({ message: "動画一覧が混み合っています。時間をおいてお試しください。" }, 503);
    return json({ message: "動画一覧を取得できませんでした。時間をおいてお試しください。" }, 502);
  }
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/videos" || pathname === "/videos.html") return handleVideoPage(request, env);
    if (pathname === "/api/config") return handleConfig(request, env);
    if (pathname === "/api/videos") return handleVideos(request, env, context);
    return env.ASSETS.fetch(request);
  }
};
