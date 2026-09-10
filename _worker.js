const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_FRIENDSHIP_URL = "https://api.line.me/friendship/v1/status";
const YOUTUBE_PLAYLIST_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const PLAYLIST_CACHE_SECONDS = 900;
const MAX_PLAYLIST_PAGES = 10;

const SERIES = [
  { key: "tutorial", title: "チュートリアル", envKey: "YT_PLAYLIST_TUTORIAL" },
  { key: "short", title: "短縮版", envKey: "YT_PLAYLIST_SHORT" },
  { key: "message", title: "文平来先生からのメッセージ", envKey: "YT_PLAYLIST_MESSAGE" }
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getBearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return match && match[1].length <= 4096 ? match[1] : "";
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
  const channelId = String(env.LINE_LOGIN_CHANNEL_ID || "").trim();
  const apiKey = String(env.YOUTUBE_API_KEY || "").trim();
  const series = SERIES.map(item => ({
    key: item.key,
    title: item.title,
    playlistId: String(env[item.envKey] || "").trim()
  }));
  return channelId && apiKey && series.every(item => item.playlistId)
    ? { channelId, apiKey, series }
    : null;
}

async function handleConfig(request, env) {
  if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
  return json({
    liffId: env.LIFF_ID || "",
    lineAddFriendUrl: env.LINE_ADD_FRIEND_URL || "https://lin.ee/XZ9COtS"
  });
}

async function handleVideos(request, env, context) {
  if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
  if (!isSameOrigin(request)) return json({ message: "許可されていないアクセスです。" }, 403);
  const settings = loadSettings(env);
  if (!settings) return json({ message: "動画ページの設定が完了していません。" }, 503);
  const token = getBearerToken(request);
  if (!token) return json({ message: "LINEでログインしてください。" }, 401);

  try {
    if (!await verifyLineAccessToken(token, settings.channelId)) {
      return json({ message: "LINE認証を確認できませんでした。" }, 401);
    }
    if (!await isOfficialAccountFriend(token)) {
      return json({ message: "このページはアボジ体操公式LINE登録者限定です。" }, 403);
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
    if (pathname === "/api/config") return handleConfig(request, env);
    if (pathname === "/api/videos") return handleVideos(request, env, context);
    return env.ASSETS.fetch(request);
  }
};
