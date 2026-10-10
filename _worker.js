const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
const LINE_FRIENDSHIP_URL = "https://api.line.me/friendship/v1/status";
const YOUTUBE_PLAYLIST_URL = "https://www.googleapis.com/youtube/v3/playlistItems";
const PLAYLIST_CACHE_SECONDS = 900;
const MAX_PLAYLIST_PAGES = 10;
const VIDEO_COOKIE_NAME = "__Host-aboji_video_access";
const VIDEO_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;
const LATEST_VIDEO_KEY = "latest-video.mp4";
const EN_COOKIE = "__Host-aboji_en_session";
const EN_SESSION_SECONDS = 60 * 60 * 24 * 30;

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

const epoch = () => Math.floor(Date.now() / 1000);
function japanDateStamp() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const randomToken = () => toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
async function hashToken(token) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
}
function noIndex(response) {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
async function parseEnBody(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) return null;
  try {
    const data = await request.json();
    return data && typeof data === "object" && JSON.stringify(data).length <= 8192 ? data : null;
  } catch (_) { return null; }
}
function field(value, max = 150) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function enEmail(value) {
  const email = field(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}
function urlFor(request, path, token) {
  const url = new URL(path, request.url);
  url.searchParams.set("token", token);
  return url.toString();
}
async function enMember(request, env) {
  if (!env.REG_DB) return null;
  const token = getCookie(request, EN_COOKIE);
  if (!/^[\w-]{30,100}$/.test(token)) return null;
  const hash = await hashToken(token);
  return env.REG_DB.prepare(
    "SELECT r.id, r.email, r.full_name FROM en_sessions s JOIN en_registrations r ON r.id=s.registration_id WHERE s.token_hash=? AND s.expires_at>? AND r.status='approved'"
  ).bind(hash, epoch()).first();
}
async function handleEnPage(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ message: "Method Not Allowed" }, 405);
  if (["/en/members", "/en/members.html", "/en/install", "/en/install.html"].includes(pathname)) {
    if (!await enMember(request, env)) return Response.redirect(new URL("/en/?access=required", request.url), 302);
  }
  const url = new URL(request.url);
  url.pathname = pathname.endsWith(".html") ? pathname : pathname === "/en" || pathname === "/en/" ? "/en/index.html" : pathname + ".html";
  url.search = "";
  return noIndex(await env.ASSETS.fetch(new Request(url, { method: request.method })));
}
async function handleEnApply(request, env, context) {
  if (request.method !== "POST") return json({ message: "Method Not Allowed" }, 405);
  if (!env.REG_DB) return json({ message: "Registration is not yet available." }, 503);
  if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ message: "Please submit this form from the English Aboji Exercise site." }, 403);
  const d = await parseEnBody(request);
  const email = enEmail(d?.email);
  const name = field(d?.name);
  const country = field(d?.country, 100);
  const timezone = field(d?.timezone, 80);
  const note = field(d?.practiceNote, 900);
  const kind = field(d?.referralKind, 20);
  const referrer = field(d?.referrerName, 150);
  const discovery = field(d?.discovery, 300);
  const emailUpdates = d?.emailUpdates === true;
  if (field(d?.website, 200) || !email || !name || !country || !timezone || !["yes","no"].includes(kind)
    || kind === "yes" && !referrer || kind === "no" && !discovery || d?.consent !== true) {
    return json({ message: "Please complete all required fields." }, 400);
  }
  if (!Number.isFinite(Number(d?.startedAt)) || epoch() - Math.floor(Number(d.startedAt) / 1000) < 3) {
    return json({ message: "Please take a moment to review the form and try again." }, 400);
  }
  const old = await env.REG_DB.prepare("SELECT id,status,submitted_at FROM en_registrations WHERE email=?").bind(email).first();
  if (old?.status === "approved") return json({ message: "This email address already has member access. Please contact the team if you need help." }, 409);
  if (old?.status === "pending" && old.submitted_at > epoch() - 86400) {
    return json({ message: "We already received an application for this email. The team will review it shortly." });
  }
  const id = old?.id || crypto.randomUUID();
  if (old) {
    await env.REG_DB.prepare("UPDATE en_registrations SET full_name=?,country=?,time_zone=?,practice_note=?,referral_kind=?,referrer_name=?,discovery=?,status='pending',submitted_at=?,reviewed_at=NULL,invite_hash=NULL,invite_expires=NULL,access_hash=NULL,access_expires=NULL WHERE id=?")
      .bind(name,country,timezone,note,kind,kind==="yes"?referrer:null,kind==="no"?discovery:null,epoch(),id).run();
  } else {
    await env.REG_DB.prepare("INSERT INTO en_registrations(id,email,full_name,country,time_zone,practice_note,referral_kind,referrer_name,discovery,status,created_at,submitted_at) VALUES(?,?,?,?,?,?,?, ?,?,'pending',?,?)")
      .bind(id,email,name,country,timezone,note,kind,kind==="yes"?referrer:null,kind==="no"?discovery:null,epoch(),epoch()).run();
  }
  await env.REG_DB.prepare("INSERT INTO en_preferences(registration_id,email_updates_opt_in,email_updates_consented_at,changed_at) VALUES(?,?,?,?) ON CONFLICT(registration_id) DO UPDATE SET email_updates_opt_in=excluded.email_updates_opt_in,email_updates_consented_at=excluded.email_updates_consented_at,changed_at=excluded.changed_at")
    .bind(id,emailUpdates?1:0,emailUpdates?epoch():null,epoch()).run();
  if (env.EN_MAIL_WEBHOOK_URL && env.EN_MAIL_WEBHOOK_SECRET) {
    const delivery=notifyEnEmail(request,env,id).catch(()=>console.warn("English application email failed"));
    if(context?.waitUntil) context.waitUntil(delivery); else await delivery;
  }
  if (env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_ADMIN_USER_ID) {
    const notify = (async () => {
      try {
        const notification = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ to: env.LINE_ADMIN_USER_ID, messages: [{ type: "text", text: `New English Aboji Exercise application\n${name} · ${country}\n${email}\n\nReview: ${new URL("/en/admin", request.url).toString()}` }] }),
          signal: AbortSignal.timeout(6000)
        });
        if (!notification.ok) console.warn("LINE application notification failed", notification.status);
      } catch (error) { console.warn("LINE application notification failed", error?.message || error); }
    })();
    if (context?.waitUntil) context.waitUntil(notify);
  }
  return json({ message: "Your application has been received. The team will review it and contact you by email. Please check your spam or promotions folder too." });
}

async function sendEnMail(env, mail) {
  if (!env.EN_MAIL_WEBHOOK_URL || !env.EN_MAIL_WEBHOOK_SECRET) return false;
  const url = new URL(env.EN_MAIL_WEBHOOK_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com') throw new Error('Invalid mail bridge');
  const response = await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.EN_MAIL_WEBHOOK_SECRET,...mail}),signal:AbortSignal.timeout(20000)});
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error('Mail delivery failed');
  return true;
}
async function notifyEnEmail(request, env, id) {
  const row = await env.REG_DB.prepare("SELECT * FROM en_registrations WHERE id=? AND status='pending'").bind(id).first();
  if (!row) return false;
  const token = randomToken();
  await env.REG_DB.prepare('INSERT INTO en_review_tokens(token_hash,registration_id,expires_at) VALUES(?,?,?)').bind(await hashToken(token),id,epoch()+604800).run();
  return sendEnMail(env,{kind:'application',to:'am6.abonim.exercise@gmail.com',subject:'【アボジ体操】英語参加申請：'+row.full_name,body:`英語の参加申請が届きました。

氏名：${row.full_name}
メール：${row.email}
国・地域：${row.country}
時間帯：${row.time_zone}
紹介者：${row.referrer_name || 'なし'}
知ったきっかけ：${row.discovery || '—'}
備考：${row.practice_note || '—'}

以下から確認・承認できます（7日間有効）。リンクを開くだけでは承認されません。
${urlFor(request,'/en/review',token)}`});
}
async function handleEnReview(request, env) {
  if (!env.REG_DB) return json({message:'Unavailable'},503);
  const d = request.method === 'POST' ? await parseEnBody(request) : null;
  const token = field(request.method === 'GET' ? new URL(request.url).searchParams.get('token') : d?.token,100);
  if (!/^[\w-]{30,100}$/.test(token)) return json({message:'Invalid review link'},401);
  const hash = await hashToken(token);
  const row = await env.REG_DB.prepare("SELECT r.* FROM en_review_tokens t JOIN en_registrations r ON r.id=t.registration_id WHERE t.token_hash=? AND t.expires_at>? AND r.status IN ('pending','held')").bind(hash,epoch()).first();
  if (!row) return json({message:'リンクは期限切れ、または申請は確認済みです。'},410);
  if (request.method === 'GET') return json({application:{full_name:row.full_name,email:row.email,country:row.country,time_zone:row.time_zone,referrer_name:row.referrer_name,discovery:row.discovery,practice_note:row.practice_note}});
  if (request.method !== 'POST') return json({message:'Method Not Allowed'},405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({message:'Forbidden'},403);
  if (!['approve','hold','reject'].includes(d?.action)) return json({message:'Invalid action'},400);
  const internal = new Request(new URL('/api/en/admin',request.url),{method:'POST',headers:{Authorization:'Bearer '+env.EN_ADMIN_SECRET,'Content-Type':'application/json'},body:JSON.stringify({id:row.id,action:d.action})});
  const response = await handleEnAdmin(internal,env);
  if (!response.ok) return response;
  await env.REG_DB.prepare('DELETE FROM en_review_tokens WHERE registration_id=?').bind(row.id).run();
  const result = await response.json();
  if (d.action === 'approve') {
    try { result.mailSent = await sendEnMail(env,{kind:'approval',to:result.email,subject:result.subject,body:result.body}); }
    catch (_) {result.mailSent=false;}
  }
  return json(result);
}

function adminAuthorized(request, env) {
  const secret = String(env.EN_ADMIN_SECRET || "");
  return secret.length >= 32 && safeStringEqual(getBearerToken(request), secret);
}
async function handleEnAdmin(request, env) {
  if (!env.REG_DB || !adminAuthorized(request, env)) return json({ message: "Unauthorized" }, 401);
  if (request.method === "GET") {
    const base = "SELECT r.id,r.email,r.full_name,r.country,r.time_zone,r.practice_note,r.referral_kind,r.referrer_name,r.discovery,r.submitted_at,r.reviewed_at,COALESCE(p.email_updates_opt_in,0) AS email_updates_opt_in FROM en_registrations r LEFT JOIN en_preferences p ON p.registration_id=r.id";
    const [pending, held, approved] = await Promise.all([
      env.REG_DB.prepare(base + " WHERE r.status='pending' ORDER BY r.submitted_at ASC LIMIT 100").all(),
      env.REG_DB.prepare(base + " WHERE r.status='held' ORDER BY r.reviewed_at DESC LIMIT 100").all(),
      env.REG_DB.prepare(base + " WHERE r.status='approved' AND r.id!='admin-preview' ORDER BY r.reviewed_at DESC LIMIT 500").all()
    ]);
    return json({ applications: pending.results || [], held: held.results || [], approved: approved.results || [] });
  }
  if (request.method !== "POST") return json({ message: "Method Not Allowed" }, 405);
  const d = await parseEnBody(request);
  if (d?.action === "notify-pending") {
    if (!env.EN_MAIL_WEBHOOK_URL || !env.EN_MAIL_WEBHOOK_SECRET) return json({message:"Email connection is not configured."},503);
    const rows=await env.REG_DB.prepare("SELECT id FROM en_registrations WHERE status='pending' ORDER BY submitted_at LIMIT 100").all();
    let sent=0;for(const row of rows.results || []) {if(await notifyEnEmail(request,env,row.id)) sent++;}
    return json({ok:true,sent});
  }
  if (d?.action === "preview") {
    const id = "admin-preview";
    const now = epoch();
    await env.REG_DB.prepare("INSERT OR IGNORE INTO en_registrations(id,email,full_name,country,time_zone,status,created_at,reviewed_at) VALUES(?,?,?,?,?,'approved',?,?)")
      .bind(id,"admin-preview@aboji.local","Administrator","Administration","Asia/Tokyo",now,now).run();
    await env.REG_DB.prepare("UPDATE en_registrations SET status='approved',full_name='Administrator' WHERE id=?").bind(id).run();
    const session = randomToken();
    const maxAge = 60 * 60;
    await env.REG_DB.prepare("INSERT INTO en_sessions(token_hash,registration_id,expires_at) VALUES(?,?,?)")
      .bind(await hashToken(session),id,now+maxAge).run();
    const response = json({ ok: true, next: "/en/members?preview=1" });
    response.headers.set("Set-Cookie", `${EN_COOKIE}=${session}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`);
    return response;
  }
  if (d?.action === "reissue") {
    const email = enEmail(d.email);
    if (!email) return json({ message: "Enter a valid email address." }, 400);
    const row = await env.REG_DB.prepare("SELECT id,email,full_name FROM en_registrations WHERE email=? AND status='approved'").bind(email).first();
    if (!row) return json({ message: "No approved member was found for that email." }, 404);
    const token = randomToken();
    const hash = await hashToken(token);
    await env.REG_DB.prepare("UPDATE en_registrations SET access_hash=?,access_expires=? WHERE id=? AND status='approved'").bind(hash,epoch()+604800,row.id).run();
    const accessUrl = urlFor(request,"/en/access",token);
    const subject = "Your Aboji Exercise member access link";
    const body = `Hello ${row.full_name},\n\nHere is a new personal link to your Aboji Exercise member practice space. Open it in the browser you plan to use for your home-screen icon. It expires in 7 days and can be used once:\n\n${accessUrl}\n\nAfter opening it, you can add the Aboji Exercise app icon from the member page. Please do not forward this personal link.\n\nAboji Exercise`;
    return json({ ok: true,email:row.email,name:row.full_name,accessUrl,subject,body,expiresInDays:7 });
  }
  if (!/^[\da-f-]{36}$/i.test(d?.id || "") || !["approve","hold","resume","reject"].includes(d?.action)) return json({ message: "Invalid request." }, 400);
  const row = await env.REG_DB.prepare("SELECT email,full_name,status FROM en_registrations WHERE id=? AND status IN ('pending','held')").bind(d.id).first();
  if (!row) return json({ message: "Application already reviewed." }, 409);
  if (d.action === "hold") {
    await env.REG_DB.prepare("UPDATE en_registrations SET status='held',reviewed_at=? WHERE id=? AND status='pending'").bind(epoch(),d.id).run();
    return json({ ok: true });
  }
  if (d.action === "resume") {
    await env.REG_DB.prepare("UPDATE en_registrations SET status='pending',reviewed_at=NULL WHERE id=? AND status='held'").bind(d.id).run();
    return json({ ok: true });
  }
  if (d.action === "reject") {
    await env.REG_DB.prepare("UPDATE en_registrations SET status='rejected',reviewed_at=? WHERE id=? AND status IN ('pending','held')").bind(epoch(),d.id).run();
    return json({ ok: true });
  }
  const token = randomToken();
  const hash = await hashToken(token);
  const updated = await env.REG_DB.prepare("UPDATE en_registrations SET status='approved',reviewed_at=?,access_hash=?,access_expires=? WHERE id=? AND status IN ('pending','held')").bind(epoch(),hash,epoch()+604800,d.id).run();
  if (!updated.meta?.changes) return json({ message: "Application already reviewed." }, 409);
  const accessUrl = urlFor(request, "/en/access", token);
  const subject = "Welcome to Aboji Exercise — Your Member Access Link";
  const body = `Hello ${row.full_name},

Thank you for applying to join Aboji Exercise.

We are pleased to let you know that your application has been approved. You can now access your personal member page using the link below.

${accessUrl}

Important information about your access link:
- This is your personal link. Please do not forward or share it with anyone.
- The link expires in 7 days and can be used only once.
- Please open it in the browser and on the device you plan to use regularly.
- After you enter the member area, that browser will remain signed in for up to 30 days.
- If you change devices, clear your browser data, or lose access, please contact us and we will issue a new link.

On your member page, you can:
- Join the Morning 6 online Zoom practice
- Watch Aboji Exercise practice and learning videos
- Record and review your practice days
- Add the Aboji Exercise icon to the home screen of your phone, tablet, or computer

Morning 6 is held online every day at 6:00 a.m. Japan time. Please participate at your own pace and according to your physical condition.

The English edition of the Aboji Exercise textbook is currently in production. We will send you more information by email as soon as it is completed.

We hope the member page will support your continued learning and daily practice.
We look forward to practicing with you.

Warm regards,
Aboji Exercise
Morning 6 Aboji Exercise Team`;
  return json({ ok: true, email: row.email, name: row.full_name, accessUrl, subject, body, expiresInDays: 7 });
}
async function handleEnAccess(request, env) {
  if (request.method !== "POST" || !env.REG_DB) return json({ message: "Unavailable" }, 405);
  const d = await parseEnBody(request);
  const token = field(d?.token, 100);
  if (!/^[\w-]{30,100}$/.test(token)) return json({ message: "Invalid access link." }, 400);
  const session = randomToken();
  const row = await env.REG_DB.prepare("UPDATE en_registrations SET access_hash=NULL,access_expires=NULL WHERE access_hash=? AND access_expires>? AND status='approved' RETURNING id").bind(await hashToken(token),epoch()).first();
  if (!row) return json({ message: "This access link has expired or has already been used." }, 410);
  await env.REG_DB.prepare("INSERT INTO en_sessions(token_hash,registration_id,expires_at) VALUES(?,?,?)").bind(await hashToken(session),row.id,epoch()+EN_SESSION_SECONDS).run();
  const response = json({ ok: true, next: "/en/members" });
  response.headers.set("Set-Cookie", `${EN_COOKIE}=${session}; Max-Age=${EN_SESSION_SECONDS}; Path=/; Secure; HttpOnly; SameSite=Lax`);
  return response;
}
async function handleEnMemberApi(request, env, context) {
  const member = await enMember(request, env);
  if (!member) return json({ message: "Please enter through your approval email." }, 401);
  const path = new URL(request.url).pathname;
  if (path === "/api/en/attendance") {
    if (request.method === "GET") {
      const today = japanDateStamp();
      const count = await env.REG_DB.prepare("SELECT COUNT(*) AS days FROM en_attendance WHERE registration_id=?").bind(member.id).first();
      const checked = await env.REG_DB.prepare("SELECT 1 AS checked FROM en_attendance WHERE registration_id=? AND practice_date=?").bind(member.id,today).first();
      return json({ days: count?.days || 0, checkedToday: Boolean(checked), practiceDate: today });
    }
    if (request.method !== "POST") return json({ message: "Method Not Allowed" }, 405);
    if (!isSameOriginRequest(request)) return json({ message: "Please check in from the member page." }, 403);
    const today = japanDateStamp();
    await env.REG_DB.prepare("INSERT OR IGNORE INTO en_attendance(registration_id,practice_date,created_at) VALUES(?,?,?)").bind(member.id,today,epoch()).run();
    const count = await env.REG_DB.prepare("SELECT COUNT(*) AS days FROM en_attendance WHERE registration_id=?").bind(member.id).first();
    return json({ days: count?.days || 0, checkedToday: true, practiceDate: today });
  }
  if (path === "/api/en/member") {
    if (request.method === "POST") {
      if (request.headers.get("Origin") !== new URL(request.url).origin) return json({ message: "Please update this setting from the member page." }, 403);
      const d = await parseEnBody(request);
      if (typeof d?.emailUpdates !== "boolean") return json({ message: "Invalid email preference." }, 400);
      await env.REG_DB.prepare("INSERT INTO en_preferences(registration_id,email_updates_opt_in,email_updates_consented_at,changed_at) VALUES(?,?,?,?) ON CONFLICT(registration_id) DO UPDATE SET email_updates_opt_in=excluded.email_updates_opt_in,email_updates_consented_at=excluded.email_updates_consented_at,changed_at=excluded.changed_at")
        .bind(member.id,d.emailUpdates?1:0,d.emailUpdates?epoch():null,epoch()).run();
      return json({ emailUpdatesOptIn: d.emailUpdates });
    }
    if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
    const prefs = await env.REG_DB.prepare("SELECT email_updates_opt_in FROM en_preferences WHERE registration_id=?").bind(member.id).first();
    return json({ name: member.full_name, email: member.email, zoomUrl: env.EN_ZOOM_URL || "", mainSiteUrl: "/", emailUpdatesOptIn: Boolean(prefs?.email_updates_opt_in) });
  }
  if (request.method !== "GET") return json({ message: "Method Not Allowed" }, 405);
  const settings = loadSettings(env);
  if (!settings) return json({ message: "Video library is currently unavailable." }, 503);
  try {
    const englishTitles = { tutorial: "Tutorials", short: "Short practice", message: "A message from Mun Pyeong-rae" };
    const series = await Promise.all(settings.series.map(async item => ({ ...item, title: englishTitles[item.key] || item.title, items: await fetchPlaylistItems(context,item.playlistId,settings.apiKey) })));
    return json({ series });
  } catch (_) { return json({ message: "Video library is currently unavailable." }, 503); }
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

async function createAccessCookieHeader(secret) {
  const cookie = await createAccessCookie(secret);
  return `${VIDEO_COOKIE_NAME}=${cookie}; Max-Age=${VIDEO_COOKIE_MAX_AGE}; Path=/; Secure; HttpOnly; SameSite=Lax`;
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
    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/videos",
        "Set-Cookie": await createAccessCookieHeader(secret),
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

function parseByteRange(value, size) {
  if (!value || !/^bytes=/i.test(value)) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2]) || size <= 0) return { invalid: true };

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true };
    const length = Math.min(suffixLength, size);
    return { offset: size - length, length };
  }

  const offset = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(requestedEnd) || offset >= size || requestedEnd < offset) {
    return { invalid: true };
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset, length: end - offset + 1 };
}

function isSameOriginRequest(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

function videoUnavailable(status = 404) {
  return json({ message: "最新動画は現在準備中です。" }, status);
}

async function handleLatestVideo(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return json({ message: "Method Not Allowed" }, 405);
  if (!isSameOriginRequest(request)) return json({ message: "許可されていないアクセスです。" }, 403);

  const secret = String(env.VIDEO_ACCESS_TOKEN || "").trim();
  if ((!secret || !await hasValidAccessCookie(request, secret)) && !await enMember(request, env)) {
    return json({ message: "動画ページから再生してください。" }, 403);
  }
  const bucket = env.VIDEO_BUCKET;
  if (!bucket || typeof bucket.head !== "function" || typeof bucket.get !== "function") return videoUnavailable(503);

  let metadata;
  try {
    metadata = await bucket.head(LATEST_VIDEO_KEY);
  } catch (_) {
    return videoUnavailable(503);
  }
  if (!metadata) return videoUnavailable(404);

  const headers = new Headers();
  if (typeof metadata.writeHttpMetadata === "function") metadata.writeHttpMetadata(headers);
  const etag = metadata.httpEtag || "";
  if (etag) headers.set("ETag", etag);
  headers.set("Content-Type", "video/mp4");
  headers.set("Content-Disposition", 'inline; filename="latest-video.mp4"');
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Vary", "Cookie");

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(metadata.size));
    return new Response(null, { status: 200, headers });
  }

  let rangeHeader = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (rangeHeader && ifRange && ifRange !== etag) rangeHeader = "";
  const range = parseByteRange(rangeHeader, metadata.size);
  if (range?.invalid) {
    headers.set("Content-Range", `bytes */${metadata.size}`);
    return new Response(null, { status: 416, headers });
  }

  let object;
  try {
    object = range
      ? await bucket.get(LATEST_VIDEO_KEY, { range: { offset: range.offset, length: range.length } })
      : await bucket.get(LATEST_VIDEO_KEY);
  } catch (_) {
    return videoUnavailable(503);
  }
  if (!object?.body) return videoUnavailable(404);
  if (typeof object.writeHttpMetadata === "function") object.writeHttpMetadata(headers);
  if (etag) headers.set("ETag", etag);
  headers.set("Content-Type", "video/mp4");
  headers.set("Content-Disposition", 'inline; filename="latest-video.mp4"');
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, no-store, max-age=0");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("Vary", "Cookie");

  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(metadata.size));
  return new Response(object.body, { status: 200, headers });
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
    const response = json({ series, refreshedWithinSeconds: PLAYLIST_CACHE_SECONDS });
    if (getAccessMode(env) === "line") {
      const secret = String(env.VIDEO_ACCESS_TOKEN || "").trim();
      if (!secret) return json({ message: "動画配信の保護設定が完了していません。" }, 503);
      response.headers.set("Set-Cookie", await createAccessCookieHeader(secret));
    }
    return response;
  } catch (error) {
    if (error?.status === 403) return json({ message: "YouTube動画の取得権限を確認してください。" }, 502);
    if (error?.status === 429) return json({ message: "動画一覧が混み合っています。時間をおいてお試しください。" }, 503);
    return json({ message: "動画一覧を取得できませんでした。時間をおいてお試しください。" }, 502);
  }
}

/*
ENGLISH "MY 120 DAYS · WONGU" PRODUCTION ADD-ON FOR THE EXISTING _worker.js

This code is designed to be merged into the existing Cloudflare Pages Worker.
It intentionally reuses the existing helpers:
  - enMember(request, env)
  - json(body, status)
  - parseEnBody(request)
  - epoch()
  - isSameOriginRequest(request)

Binding used:
  - env.REG_DB  (the same English registration D1 database already in production)

Optional environment variable:
  - EN_120_START_DATE  (YYYY-MM-DD, default: 2026-10-10)

Add this route inside the existing export default fetch():
  if (pathname === "/api/en/120") return handleEn120(request, env);
*/

const EN120_DEFAULT_START = "2026-10-10";
const EN120_DAYS = 120;
const EN120_ALLOWED_EVENTS = new Set([
  "zoom","videos","news","body_check_open","video_play","link"
]);

function en120TimeZone(value) {
  const candidate = String(value || "").trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate || "Asia/Tokyo" }).format(new Date());
    return candidate || "Asia/Tokyo";
  } catch (_) {
    return "Asia/Tokyo";
  }
}

function en120DateStamp(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function en120ValidYmd(value) {
  const v=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(v))return false;
  const [y,m,d]=v.split('-').map(Number),dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}

function en120Day(startYmd, currentYmd) {
  const [sy,sm,sd] = startYmd.split("-").map(Number);
  const [cy,cm,cd] = currentYmd.split("-").map(Number);
  return Math.floor((Date.UTC(cy,cm-1,cd) - Date.UTC(sy,sm-1,sd)) / 86400000) + 1;
}

function en120Text(value, max = 180) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, max)
    : "";
}

async function en120Context(request, env) {
  if (!env.REG_DB) return null;
  const member = await enMember(request, env);
  if (!member) return null;
  const profile = await env.REG_DB.prepare(
    "SELECT country,time_zone FROM en_registrations WHERE id=? AND status='approved'"
  ).bind(member.id).first();
  const timeZone = en120TimeZone(profile?.time_zone);
  const localDate = en120DateStamp(timeZone);
  const configured = String(env.EN_120_START_DATE || EN120_DEFAULT_START).trim();
  const challengeStart = en120ValidYmd(configured) ? configured : EN120_DEFAULT_START;
  const currentDay = en120Day(challengeStart, localDate);
  return { member, profile: profile || {}, timeZone, localDate, challengeStart, currentDay };
}

async function en120ActiveChecklist(env, registrationId) {
  const rows = await env.REG_DB.prepare(
    `SELECT id,text,source,severity,updated_at
       FROM en_120_checklist
      WHERE registration_id=? AND active=1
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 500`
  ).bind(registrationId).all();
  return rows.results || [];
}

async function en120MilestoneChecks(env, registrationId) {
  const rows = await env.REG_DB.prepare(
    `SELECT id,challenge_day,milestone_day,local_date,item_count,created_at
       FROM en_120_body_checks
      WHERE registration_id=? AND milestone_day IS NOT NULL
      ORDER BY milestone_day ASC`
  ).bind(registrationId).all();
  return rows.results || [];
}

async function en120BodyChecks(env, registrationId) {
  const rows = await env.REG_DB.prepare(
    `SELECT id,challenge_day,milestone_day,local_date,item_count,created_at
       FROM en_120_body_checks
      WHERE registration_id=?
      ORDER BY created_at DESC
      LIMIT 40`
  ).bind(registrationId).all();
  return rows.results || [];
}

function en120MilestoneMap(checks) {
  const out = {};
  for (const c of checks) if (c.milestone_day) out[String(c.milestone_day)] = c;
  return out;
}

function en120DueMilestone(currentDay, milestones) {
  if (!milestones["1"]) return 1;
  if (currentDay >= 40 && !milestones["40"]) return 40;
  if (currentDay >= 80 && !milestones["80"]) return 80;
  if (currentDay >= 120 && !milestones["120"]) return 120;
  return null;
}

async function en120ReadState(ctx, env, { recordVisit = false } = {}) {
  const id = ctx.member.id;
  if (recordVisit && ctx.currentDay >= 1 && ctx.currentDay <= EN120_DAYS) {
    await env.REG_DB.prepare(
      `INSERT OR IGNORE INTO en_120_visits(registration_id,visit_date,challenge_day,created_at)
       VALUES(?,?,?,?)`
    ).bind(id, ctx.localDate, ctx.currentDay, epoch()).run();
  }

  const [visits, todayVisit, checklist, checks, milestoneChecks] = await Promise.all([
    env.REG_DB.prepare("SELECT challenge_day FROM en_120_visits WHERE registration_id=? AND challenge_day BETWEEN 1 AND 120 ORDER BY challenge_day ASC").bind(id).all(),
    env.REG_DB.prepare("SELECT 1 AS yes FROM en_120_visits WHERE registration_id=? AND visit_date=?").bind(id,ctx.localDate).first(),
    en120ActiveChecklist(env,id),
    en120BodyChecks(env,id),
    en120MilestoneChecks(env,id)
  ]);

  const visitDays = [...new Set((visits.results || []).map(r => Number(r.challenge_day)).filter(n => Number.isInteger(n) && n >= 1 && n <= 120))];
  const milestones = en120MilestoneMap(milestoneChecks);
  return {
    memberKey: ctx.member.id,
    displayName: ctx.member.full_name,
    timeZone: ctx.timeZone,
    localDate: ctx.localDate,
    challengeStart: ctx.challengeStart,
    currentDay: ctx.currentDay,
    practiceDays: visitDays.length,
    visitDays,
    recordedToday: Boolean(todayVisit),
    checklist,
    bodyChecks: checks,
    milestones,
    bodyCheckDue: en120DueMilestone(ctx.currentDay, milestones)
  };
}

async function en120AddManualItem(ctx, env, d) {
  const text = en120Text(d?.text, 180);
  if (!text) return json({ message: "Please enter something to add." }, 400);
  const current = await env.REG_DB.prepare("SELECT COUNT(*) AS n FROM en_120_checklist WHERE registration_id=? AND active=1").bind(ctx.member.id).first();
  if (Number(current?.n || 0) >= 100) return json({ message: "You can keep up to 100 active body notes." }, 409);
  const id = crypto.randomUUID();
  await env.REG_DB.prepare(
    `INSERT INTO en_120_checklist
      (id,registration_id,source_key,text,source,severity,active,created_at,updated_at)
     VALUES(?,?,?,?, 'manual',0,1,?,?)`
  ).bind(id,ctx.member.id,`manual:${id}`,text,epoch(),epoch()).run();
  return json(await en120ReadState(ctx,env));
}

async function en120RemoveItem(ctx, env, d) {
  const id = en120Text(d?.id, 80);
  if (!id) return json({ message: "Invalid checklist item." }, 400);
  await env.REG_DB.prepare(
    `UPDATE en_120_checklist
        SET active=0,resolved_at=?,updated_at=?
      WHERE id=? AND registration_id=?`
  ).bind(epoch(),epoch(),id,ctx.member.id).run();
  return json(await en120ReadState(ctx,env));
}

async function en120SaveBodyCheck(ctx, env, d) {
  const allowedLabels = {
    pain: "Pain or soreness", neck_shoulders: "Neck and shoulders", back: "Back and lower back",
    movement: "Movement", breathing: "Breathing", other: "Other"
  };
  const raw = Array.isArray(d?.answers) ? d.answers.slice(0, 6) : [];
  const answers = raw.map(a => ({
    key: en120Text(a?.key, 60),
    label: allowedLabels[en120Text(a?.key, 60)] || "",
    yes: a?.yes === true,
    detail: en120Text(a?.detail, 240),
    severity: Math.max(0,Math.min(4,Math.trunc(Number(a?.severity || 0))))
  })).filter(a => a.key && a.label);

  if (!answers.length) return json({ message: "No body-check answers were received." }, 400);

  const now = epoch();
  for (const a of answers) {
    const sourceKey = `question:${a.key}`;
    if (a.yes) {
      const text = a.detail ? `${a.label}: ${a.detail}` : a.label;
      const existing = await env.REG_DB.prepare(
        "SELECT id FROM en_120_checklist WHERE registration_id=? AND source_key=?"
      ).bind(ctx.member.id,sourceKey).first();
      if (existing?.id) {
        await env.REG_DB.prepare(
          `UPDATE en_120_checklist
              SET text=?,source='questionnaire',severity=?,active=1,resolved_at=NULL,updated_at=?
            WHERE id=? AND registration_id=?`
        ).bind(text,a.severity,now,existing.id,ctx.member.id).run();
      } else {
        await env.REG_DB.prepare(
          `INSERT INTO en_120_checklist
            (id,registration_id,source_key,text,source,severity,active,created_at,updated_at)
           VALUES(?,?,?,?, 'questionnaire',?,1,?,?)`
        ).bind(crypto.randomUUID(),ctx.member.id,sourceKey,text,a.severity,now,now).run();
      }
    } else {
      await env.REG_DB.prepare(
        `UPDATE en_120_checklist
            SET active=0,resolved_at=?,updated_at=?
          WHERE registration_id=? AND source_key=? AND source='questionnaire' AND active=1`
      ).bind(now,now,ctx.member.id,sourceKey).run();
    }
  }

  const checklist = await en120ActiveChecklist(env,ctx.member.id);
  const checksBefore = await en120MilestoneChecks(env,ctx.member.id);
  const milestones = en120MilestoneMap(checksBefore);
  const milestone = en120DueMilestone(ctx.currentDay,milestones);

  await env.REG_DB.prepare(
    `INSERT OR IGNORE INTO en_120_body_checks
      (id,registration_id,challenge_day,milestone_day,local_date,item_count,answers_json,checklist_json,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).bind(
    crypto.randomUUID(),
    ctx.member.id,
    Math.max(0,Math.min(EN120_DAYS,ctx.currentDay)),
    milestone,
    ctx.localDate,
    checklist.length,
    JSON.stringify(answers),
    JSON.stringify(checklist),
    now
  ).run();

  return json(await en120ReadState(ctx,env));
}


async function en120SaveSnapshot(ctx, env) {
  const now = epoch();
  const checklist = await en120ActiveChecklist(env,ctx.member.id);
  const checks = await en120MilestoneChecks(env,ctx.member.id);
  const milestone = en120DueMilestone(ctx.currentDay,en120MilestoneMap(checks));
  await env.REG_DB.prepare(
    `INSERT OR IGNORE INTO en_120_body_checks
      (id,registration_id,challenge_day,milestone_day,local_date,item_count,answers_json,checklist_json,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`
  ).bind(crypto.randomUUID(),ctx.member.id,Math.max(0,Math.min(EN120_DAYS,ctx.currentDay)),milestone,ctx.localDate,checklist.length,'[]',JSON.stringify(checklist),now).run();
  return json(await en120ReadState(ctx,env));
}

async function en120BodyCheckDetail(ctx, env, d) {
  const id = en120Text(d?.id,80);
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({message:"Invalid body record."},400);
  const row = await env.REG_DB.prepare(
    `SELECT id,challenge_day,milestone_day,local_date,item_count,answers_json,checklist_json,created_at
       FROM en_120_body_checks
      WHERE id=? AND registration_id=?`
  ).bind(id,ctx.member.id).first();
  if (!row) return json({message:"Body record not found."},404);
  return json({record:row});
}

async function en120Event(ctx, env, d) {
  const type = en120Text(d?.eventType, 40);
  if (!EN120_ALLOWED_EVENTS.has(type)) return json({ message: "Unknown event." }, 400);
  const meta = d?.meta && typeof d.meta === "object" ? JSON.stringify(d.meta).slice(0,2000) : null;
  await env.REG_DB.prepare(
    `INSERT INTO en_120_events(registration_id,event_type,event_date,meta_json,created_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(registration_id,event_type,event_date)
     DO UPDATE SET meta_json=excluded.meta_json,created_at=excluded.created_at`
  ).bind(ctx.member.id,type,ctx.localDate,meta,epoch()).run();
  return json({ ok:true });
}

function en120SameOriginWrite(request) {
  const target = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin) return origin === target;
  const referer = request.headers.get("Referer");
  if (!referer) return false;
  try { return new URL(referer).origin === target; } catch (_) { return false; }
}

async function handleEn120(request, env) {
  const ctx = await en120Context(request, env);
  if (!ctx) return json({ message: "Your member session has expired. Please use your personal approval email link." }, 401);

  if (request.method === "GET") {
    return json(await en120ReadState(ctx,env,{recordVisit:true}));
  }

  if (request.method !== "POST") return json({ message: "Method Not Allowed" }, 405);
  if (!en120SameOriginWrite(request)) return json({ message: "Please use this feature from your member page." }, 403);
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("Content-Type") || "")) return json({ message: "JSON request required." }, 415);

  const d = await parseEnBody(request);
  if (!d) return json({ message: "Invalid request." }, 400);

  if (d.action === "add-item") return en120AddManualItem(ctx,env,d);
  if (d.action === "remove-item") return en120RemoveItem(ctx,env,d);
  if (d.action === "body-check") return en120SaveBodyCheck(ctx,env,d);
  if (d.action === "snapshot") return en120SaveSnapshot(ctx,env);
  if (d.action === "body-check-detail") return en120BodyCheckDetail(ctx,env,d);
  if (d.action === "event") return en120Event(ctx,env,d);
  return json({ message: "Unknown action." }, 400);
}

export default {
  async fetch(request, env, context) {
    const pathname = new URL(request.url).pathname;
    if (pathname === "/en/news" || pathname === "/en/news.html") {
      const url = new URL(request.url);
      url.pathname = "/en/news.html";
      url.search = "";
      return env.ASSETS.fetch(new Request(url, { method: request.method }));
    }
    if (["/en", "/en/", "/en/index.html", "/en/apply", "/en/apply.html", "/en/access", "/en/access.html", "/en/admin", "/en/admin.html", "/en/members", "/en/members.html", "/en/install", "/en/install.html"].includes(pathname)) return handleEnPage(request, env, pathname);
    if (pathname === "/api/en/apply") return handleEnApply(request, env, context);
    if (pathname === "/en/review" || pathname === "/en/review.html") return handleEnPage(request,env,"/en/review.html");
    if (pathname === "/api/en/review") return handleEnReview(request,env);
    if (pathname === "/api/en/admin") return handleEnAdmin(request, env);
    if (pathname === "/api/en/access") return handleEnAccess(request, env);
    if (pathname === "/api/en/120") return handleEn120(request, env);
    if (["/api/en/member", "/api/en/videos", "/api/en/attendance"].includes(pathname)) return handleEnMemberApi(request, env, context);
    if (pathname === "/videos" || pathname === "/videos.html") return handleVideoPage(request, env);
    if (pathname === "/api/config") return handleConfig(request, env);
    if (pathname === "/api/videos") return handleVideos(request, env, context);
    if (pathname === "/media/latest-video") return handleLatestVideo(request, env);
    return env.ASSETS.fetch(request);
  }
};
