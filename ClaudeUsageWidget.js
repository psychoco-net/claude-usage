// ============================================================
// Claude Usage Widget for Scriptable (iOS)
// ============================================================
//
// 【セットアップ手順】
//
// 1. App Store から「Scriptable」をインストール
// 2. Safari で claude.ai にログインしておく
// 3. このスクリプトを Scriptable に貼り付けて実行
// 4. 自動で Organization ID 検出・データ取得・キャッシュ保存
//
// 【ホーム画面ウィジェット】
//    ホーム画面長押し > 「+」 > Scriptable > Medium or Small
//    ウィジェット長押し > 「ウィジェットを編集」> Script を選択
//
// 【ロック画面ウィジェット（円グラフ）】
//    ロック画面長押し > 「カスタマイズ」> ウィジェット追加
//    Scriptable の「円形」または「長方形」を選択
//    ウィジェット長押し > 「ウィジェットを編集」> Script を選択
//
//    円形ウィジェットの場合、Parameter で表示項目を指定:
//      session  → 現在のセッション（デフォルト）
//      weekly   → すべてのモデル（週間）
//      sonnet   → Sonnetのみ
//      opus     → Opusのみ
//    複数配置して、それぞれ異なる Parameter を設定してください。
//
// 【データの更新】
//    ウィジェットはキャッシュを表示します。
//    データを更新するにはウィジェットをタップしてください。
//    ショートカット App で定期実行を設定すると自動更新も可能です。
//
// ============================================================

// ==================== 定数 ====================
const KEYCHAIN_ORG = "claude_usage_org_id";
const CACHE_FILE = "claude_usage_cache.json";
const REFRESH_MINUTES = 15;
const ERROR_REFRESH_MINUTES = 60;
const CACHE_FRESH_MINUTES = 30;
const CACHE_STALE_MINUTES = 120;

// ==================== カラー ====================
const dark = Device.isUsingDarkAppearance();

const C = {
  bg:     dark ? new Color("#111116") : new Color("#f5f5f7"),
  text:   dark ? new Color("#e5e5ea") : new Color("#1c1c1e"),
  sub:    dark ? new Color("#8e8e93") : new Color("#6e6e73"),
  barBg:  dark ? new Color("#2c2c34") : new Color("#e5e5ea"),
  green:  new Color("#30d158"),
  amber:  new Color("#ff9f0a"),
  red:    new Color("#ff453a"),
  accent: new Color("#d97757"),
  lockBg: new Color("#1c1c1e", 0),
  lockFg: new Color("#ffffff"),
  lockDim: new Color("#ffffff", 0.3),
};

// ==================== キャッシュ管理 ====================

const fm = FileManager.local();
const cacheDir = fm.joinPath(fm.documentsDirectory(), "claude-usage");
const cachePath = fm.joinPath(cacheDir, CACHE_FILE);

function ensureCacheDir() {
  if (!fm.fileExists(cacheDir)) {
    fm.createDirectory(cacheDir, true);
  }
}

function writeCache(data) {
  ensureCacheDir();
  const payload = {
    timestamp: new Date().toISOString(),
    data: data,
  };
  fm.writeString(cachePath, JSON.stringify(payload));
}

function readCache() {
  if (!fm.fileExists(cachePath)) return null;
  try {
    return JSON.parse(fm.readString(cachePath));
  } catch {
    return null;
  }
}

// ==================== Keychain（orgId のみ） ====================

function getOrgId() {
  return Keychain.contains(KEYCHAIN_ORG) ? Keychain.get(KEYCHAIN_ORG) : null;
}

function saveOrgId(orgId) {
  Keychain.set(KEYCHAIN_ORG, orgId);
}

// ==================== WebView 認証済みリクエスト ====================

async function fetchViaWebView(url) {
  const wv = new WebView();

  try {
    await wv.loadURL(url);
  } catch (e) {
    return { ok: false, data: null, err: "loadURL失敗: " + String(e) };
  }

  try {
    await wv.waitForLoad();
  } catch {}

  let currentURL;
  try {
    currentURL = await wv.evaluateJavaScript("window.location.href", false);
  } catch {
    currentURL = "";
  }

  if (currentURL.includes("/login") || currentURL.includes("/oauth")) {
    return { ok: false, data: null, err: "auth" };
  }

  let bodyText;
  try {
    bodyText = await wv.evaluateJavaScript(
      "document.body.innerText || document.body.textContent || ''",
      false
    );
  } catch (e) {
    return { ok: false, data: null, err: "JS実行失敗: " + String(e) };
  }

  if (!bodyText || bodyText.trim() === "") {
    return { ok: false, data: null, err: "空のレスポンス" };
  }

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return { ok: false, data: null, err: "parse" };
  }

  if (json && json.error) {
    const msg = json.error.message || json.error.type || JSON.stringify(json.error);
    return { ok: false, data: json, err: msg };
  }

  return { ok: true, data: json, err: null };
}

// ==================== Organization ID 自動検出 ====================

async function discoverOrgId() {
  const result = await fetchViaWebView("https://claude.ai/api/organizations");
  if (!result.ok) return result;

  const orgs = result.data;
  if (!Array.isArray(orgs) || orgs.length === 0) {
    return { ok: false, data: orgs, err: "組織が見つかりません" };
  }

  const orgId = orgs[0].uuid || orgs[0].id;
  if (!orgId) {
    return { ok: false, data: orgs, err: "組織IDを抽出できません" };
  }

  return { ok: true, data: orgId, err: null };
}

// ==================== データ取得 ====================

async function fetchUsageLive() {
  let orgId = getOrgId();

  if (!orgId) {
    const orgResult = await discoverOrgId();
    if (!orgResult.ok) {
      return { ok: false, data: null, err: orgResult.err };
    }
    orgId = orgResult.data;
    saveOrgId(orgId);
  }

  const url = "https://claude.ai/api/organizations/" + orgId + "/usage";
  const result = await fetchViaWebView(url);

  if (!result.ok) {
    return { ok: false, data: null, err: result.err };
  }

  if (!result.data || !Array.isArray(result.data.limits)) {
    return { ok: false, data: result.data, err: "unexpected format" };
  }

  writeCache(result.data);
  return { ok: true, data: result.data, err: null };
}

function loadFromCache() {
  const cache = readCache();
  if (!cache || !cache.data) {
    return { ok: false, data: null, err: "キャッシュなし", timestamp: null };
  }
  return { ok: true, data: cache.data, err: null, timestamp: cache.timestamp };
}

function errMessage(err) {
  if (err === "auth") return "Safari で claude.ai にログインしてから\n再実行してください";
  if (err === "parse") return "ログイン切れ、またはサーバーエラーです\nSafari で claude.ai を確認してください";
  return err || "不明なエラー";
}

function errTitle(err) {
  if (err === "auth" || err === "parse") return "ログインが必要です";
  return "データ取得失敗";
}

// ==================== Claude ロゴ ====================

const LOGO_PATH = [
  [0,7.75,26.27],[1,15.52,21.91],[1,15.65,21.53],[1,15.52,21.32],[1,15.14,21.32],
  [1,13.84,21.24],[1,9.40,21.12],[1,5.55,20.96],[1,1.82,20.76],[1,0.88,20.56],
  [1,-0.00,19.40],[1,0.09,18.82],[1,0.88,18.29],[1,2.01,18.39],[1,4.51,18.56],
  [1,8.26,18.82],[1,10.98,18.98],[1,15.01,19.40],[1,15.65,19.40],[1,15.74,19.14],
  [1,15.52,18.98],[1,15.35,18.82],[1,11.47,16.19],[1,7.27,13.41],[1,5.07,11.81],
  [1,3.88,11.00],[1,3.28,10.24],[1,3.02,8.58],[1,4.10,7.39],[1,5.55,7.49],
  [1,5.92,7.59],[1,7.39,8.72],[1,10.53,11.15],[1,14.63,14.17],[1,15.23,14.67],
  [1,15.47,14.50],[1,15.50,14.38],[1,15.23,13.93],[1,13.00,9.90],[1,10.62,5.80],
  [1,9.56,4.10],[1,9.28,3.08],
  [2,9.18,2.66,9.11,2.31,9.11,1.88],
  [1,10.34,0.21],[1,11.02,-0.01],[1,12.66,0.21],[1,13.35,0.81],[1,14.37,3.14],
  [1,16.02,6.81],[1,18.58,11.80],[1,19.33,13.28],[1,19.73,14.65],[1,19.88,15.07],
  [1,20.14,15.07],[1,20.14,14.83],[1,20.35,12.02],[1,20.74,8.57],[1,21.12,4.13],
  [1,21.25,2.88],[1,21.87,1.38],[1,23.10,0.57],[1,24.06,1.03],[1,24.85,2.16],
  [1,24.74,2.89],[1,24.27,5.94],[1,23.35,10.72],[1,22.75,13.92],[1,23.10,13.92],
  [1,23.50,13.52],[1,25.12,11.37],[1,27.84,7.97],[1,29.04,6.62],[1,30.44,5.13],
  [1,31.34,4.42],[1,33.04,4.42],[1,34.29,6.28],[1,33.73,8.20],[1,31.98,10.42],
  [1,30.53,12.30],[1,28.45,15.10],[1,27.15,17.34],[1,27.27,17.52],[1,27.58,17.49],
  [1,32.28,16.49],[1,34.82,16.03],[1,37.85,15.51],[1,39.22,16.15],[1,39.37,16.80],
  [1,38.83,18.13],[1,35.59,18.93],[1,31.79,19.69],[1,26.13,21.03],[1,26.06,21.08],
  [1,26.14,21.18],[1,28.69,21.42],[1,29.78,21.48],[1,32.45,21.48],[1,37.42,21.85],
  [1,38.72,22.71],[1,39.50,23.76],[1,39.37,24.56],[1,37.37,25.58],[1,34.67,24.94],
  [1,28.37,23.44],[1,26.21,22.90],[1,25.91,22.90],[1,25.91,23.08],[1,27.71,24.84],
  [1,31.01,27.82],[1,35.14,31.66],[1,35.35,32.61],[1,34.82,33.36],[1,34.26,33.28],
  [1,30.63,30.55],[1,29.23,29.32],[1,26.06,26.65],[1,25.85,26.65],[1,25.85,26.93],
  [1,26.58,28.00],[1,30.44,33.80],[1,30.64,35.58],[1,30.36,36.16],[1,29.36,36.51],
  [1,28.26,36.31],[1,26.00,33.14],[1,23.67,29.57],[1,21.79,26.37],[1,21.56,26.50],
  [1,20.45,38.45],[1,19.93,39.06],[1,18.73,39.52],[1,17.73,38.76],[1,17.20,37.53],
  [1,17.73,35.10],[1,18.37,31.93],[1,18.89,29.41],[1,19.36,26.28],[1,19.64,25.24],
  [1,19.62,25.17],[1,19.39,25.20],[1,17.03,28.44],[1,13.44,33.29],[1,10.60,36.33],
  [1,9.92,36.60],[1,8.74,35.99],[1,8.85,34.90],[1,9.51,33.93],[1,13.44,28.93],
  [1,15.81,25.83],[1,17.34,24.04],[1,17.33,23.78],[1,17.24,23.78],[1,6.80,30.56],
  [1,4.94,30.80],[1,4.14,30.05],[1,4.24,28.82],[1,4.62,28.42],[1,7.76,26.26],[3],
];

function drawClaudeLogo(size) {
  const s = size / 39.53;
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const p = new Path();
  for (const c of LOGO_PATH) {
    switch (c[0]) {
      case 0: p.move(new Point(c[1] * s, c[2] * s)); break;
      case 1: p.addLine(new Point(c[1] * s, c[2] * s)); break;
      case 2: p.addCurve(
                new Point(c[5] * s, c[6] * s),
                new Point(c[1] * s, c[2] * s),
                new Point(c[3] * s, c[4] * s)); break;
      case 3: p.closeSubpath(); break;
    }
  }

  ctx.addPath(p);
  ctx.setFillColor(C.accent);
  ctx.fillPath();
  return ctx.getImage();
}

// ==================== ユーティリティ ====================

function barColor(pct) {
  if (pct >= 80) return C.red;
  if (pct >= 50) return C.amber;
  return C.green;
}

function cacheAgeColor(isoStr) {
  if (!isoStr) return C.sub;
  try {
    const m = (Date.now() - new Date(isoStr).getTime()) / 60000;
    if (isNaN(m)) return C.sub;
    if (m <= CACHE_FRESH_MINUTES) return C.green;
    if (m <= CACHE_STALE_MINUTES) return C.amber;
    return C.red;
  } catch {
    return C.sub;
  }
}

function fmtReset(isoStr) {
  if (!isoStr) return null;
  try {
    const reset = new Date(isoStr);
    if (isNaN(reset.getTime())) return null;
    const diff = reset - new Date();
    if (diff <= 0) return "リセット済み";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h >= 24) return `${Math.floor(h / 24)}日 ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  } catch {
    return null;
  }
}

function toPct(utilization) {
  if (utilization === null || utilization === undefined || isNaN(utilization)) {
    return null;
  }
  return Math.min(100, Math.max(0, Math.round(utilization)));
}

function getBarWidth() {
  const f = config.widgetFamily;
  if (f === "small") return 70;
  if (f === "large") return 200;
  return 180;
}

function isSmall() {
  return config.widgetFamily === "small";
}

function isLockScreen() {
  const f = config.widgetFamily;
  return f === "accessoryCircular" || f === "accessoryRectangular" || f === "accessoryInline";
}

function fmtAge(isoStr) {
  if (!isoStr) return null;
  try {
    const m = Math.floor((Date.now() - new Date(isoStr).getTime()) / 60000);
    if (isNaN(m)) return null;
    if (m < 1) return "たった今";
    if (m < 60) return `${m}分前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}時間前`;
    return `${Math.floor(h / 24)}日前`;
  } catch {
    return null;
  }
}

// ==================== データ整形 ====================

// Parameter 文字列から API キーへのマッピング
const PARAM_MAP = {
  session: "session",
  "5h": "session",

  weekly: "weekly_all",
  "7d": "weekly_all",
  all: "weekly_all",

  fable: "Fable",
  sonnet: "Sonnet",
  opus: "Opus",
};

// 表示ラベル（短縮版をロック画面用に追加）
const DEFS = [
  {
    key: "session",
    label: "プラン使用量",
    short: "5h",
    section: "現在のセッション",
  },
  {
    key: "weekly_all",
    label: "すべてのプラン",
    short: "All",
    section: "週間制限",
  },
  {
    key: "weekly_scoped",
    label: null,
    short: null,
    section: "週間制限",
  },
];

function parse(raw) {
  const items = [];

  for (const limit of (raw.limits ?? [])) {

    const def = DEFS.find(d => d.key === limit.kind);

    const modelName =
      limit.scope?.model?.display_name ?? null;

    items.push({
      key: limit.kind,
      label:
        def?.label ??
        modelName ??
        limit.kind,

      short:
        def?.short ??
        modelName ??
        limit.kind,

      pct: limit.percent,
      reset: limit.resets_at || null,

      section:
        def?.section ??
        (limit.group === "weekly"
          ? "週間制限"
          : limit.group),
    });
  }

  return items;
}

/**
 * Parameter 文字列から対応する項目を1つ返す。
 * 見つからなければ最初の項目（セッション）を返す。
 */
function getItemByParam(items, param) {
  if (param) {
    const p = param.trim().toLowerCase();
    const key = PARAM_MAP[p];

    if (key) {
      const found = items.find((it) =>
        it.key === key ||
        it.label.toLowerCase() === key.toLowerCase()
      );

      if (found) return found;
    }
  }

  return items[0] || null;
}

// ==================== 円グラフ描画 ====================

/**
 * DrawContext で円形プログレスリングを描画する。
 * ロック画面ウィジェット用。
 *
 * @param {number} size    画像サイズ
 * @param {number} pct     パーセント (0-100)
 * @param {string} label   中央下に表示するラベル
 * @param {number} lineW   リングの太さ
 * @param {Color}  fgColor 進捗の色
 * @param {Color}  bgColor トラックの色
 * @param {Color}  textColor テキストの色
 */
function drawRing(size, pct, lineW, fgColor, bgColor, textColor, logoColor) {
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - lineW) / 2 - 1;
  const segments = 72;

  // 背景トラック（フルリング）
  drawArcPath(ctx, cx, cy, r, 0, 360, lineW, bgColor, segments);

  // 進捗（12時位置 = -90° から時計回り）
  if (pct > 0) {
    const angle = Math.min(pct, 100) / 100 * 360;
    drawArcPath(ctx, cx, cy, r, -90, -90 + angle, lineW, fgColor, segments);
  }

  // 中央: Claude ロゴ（小）
  const logoSize = Math.floor(size * 0.22);
  const logoImg = drawClaudeLogoWithColor(logoSize, logoColor);
  const logoX = cx - logoSize / 2;
  const logoY = cy - logoSize / 2 - Math.floor(size * 0.13);
  ctx.drawImageAtPoint(logoImg, new Point(logoX, logoY));

  // 中央: パーセント（大）
  const pctStr = `${pct}%`;
  const pctFontSize = Math.floor(size * 0.28);
  ctx.setFont(Font.boldSystemFont(pctFontSize));
  ctx.setTextColor(textColor);
  ctx.setTextAlignedCenter();

  const pctRectH = pctFontSize * 1.3;
  const pctY = cy - pctRectH / 2 + Math.floor(size * 0.10);
  ctx.drawTextInRect(pctStr, new Rect(0, pctY, size, pctRectH));

  return ctx.getImage();
}

/**
 * 任意の色で Claude ロゴを描画する。
 * ロック画面では白、ホーム画面ではアクセント色で使い分ける。
 */
function drawClaudeLogoWithColor(size, color) {
  const s = size / 39.53;
  const ctx = new DrawContext();
  ctx.size = new Size(size, size);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const p = new Path();
  for (const c of LOGO_PATH) {
    switch (c[0]) {
      case 0: p.move(new Point(c[1] * s, c[2] * s)); break;
      case 1: p.addLine(new Point(c[1] * s, c[2] * s)); break;
      case 2: p.addCurve(
                new Point(c[5] * s, c[6] * s),
                new Point(c[1] * s, c[2] * s),
                new Point(c[3] * s, c[4] * s)); break;
      case 3: p.closeSubpath(); break;
    }
  }

  ctx.addPath(p);
  ctx.setFillColor(color);
  ctx.fillPath();
  return ctx.getImage();
}

/**
 * DrawContext に円弧パスを描画する。
 * Path + addLine で近似。
 */
function drawArcPath(ctx, cx, cy, r, startDeg, endDeg, lineW, color, segments) {
  const step = (endDeg - startDeg) / segments;

  // 外側の弧
  const outerR = r + lineW / 2;
  const innerR = r - lineW / 2;

  const p = new Path();

  // 外側を startDeg → endDeg
  for (let i = 0; i <= segments; i++) {
    const deg = startDeg + step * i;
    const rad = deg * Math.PI / 180;
    const x = cx + outerR * Math.cos(rad);
    const y = cy + outerR * Math.sin(rad);
    if (i === 0) {
      p.move(new Point(x, y));
    } else {
      p.addLine(new Point(x, y));
    }
  }

  // 内側を endDeg → startDeg（逆順）
  for (let i = segments; i >= 0; i--) {
    const deg = startDeg + step * i;
    const rad = deg * Math.PI / 180;
    const x = cx + innerR * Math.cos(rad);
    const y = cy + innerR * Math.sin(rad);
    p.addLine(new Point(x, y));
  }

  p.closeSubpath();
  ctx.addPath(p);
  ctx.setFillColor(color);
  ctx.fillPath();
}

/**
 * パーセント中央 + 下部ラベルのリング。
 * ラベルも画像内に焼き込むので確実に中央揃えになる。
 */
function drawRingSimple(size, pct, label, lineW, fgColor, bgColor, textColor) {
  const labelH = label ? Math.floor(size * 0.28) : 0;
  const totalH = size + labelH;
  const ctx = new DrawContext();
  ctx.size = new Size(size, totalH);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - lineW) / 2 - 1;
  const segments = 72;

  drawArcPath(ctx, cx, cy, r, 0, 360, lineW, bgColor, segments);

  if (pct > 0) {
    const angle = Math.min(pct, 100) / 100 * 360;
    drawArcPath(ctx, cx, cy, r, -90, -90 + angle, lineW, fgColor, segments);
  }

  const pctStr = `${pct}%`;
  const pctFontSize = Math.floor(size * 0.32);
  ctx.setFont(Font.boldSystemFont(pctFontSize));
  ctx.setTextColor(textColor);
  ctx.setTextAlignedCenter();

  const pctRectH = pctFontSize * 1.3;
  const pctY = cy - pctRectH / 2;
  ctx.drawTextInRect(pctStr, new Rect(0, pctY, size, pctRectH));

  // ラベル（リング下部に焼き込み）
  if (label) {
    const lblFontSize = Math.max(8, Math.floor(size * 0.22));
    ctx.setFont(Font.mediumSystemFont(lblFontSize));
    ctx.setTextColor(textColor);
    ctx.drawTextInRect(label, new Rect(0, size, size, labelH));
  }

  return ctx.getImage();
}

// ==================== ロック画面ウィジェット ====================

/**
 * accessoryCircular: 単一の円グラフ
 * Parameter で表示項目を選択する
 */
function buildCircularWidget(items) {
  const param = args.widgetParameter;
  const item = getItemByParam(items, param);

  const w = new ListWidget();
  w.backgroundColor = C.lockBg;
  w.setPadding(0, 0, 0, 0);
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);

  if (!item) {
    const t = w.addText("--");
    t.font = Font.boldSystemFont(16);
    t.textColor = C.lockFg;
    t.centerAlignText();
    w.url = URLScheme.forRunningScript();
    return w;
  }

  const img = drawRing(
    76, item.pct, 5,
    C.lockFg, C.lockDim, C.lockFg, C.lockFg
  );
  const imgEl = w.addImage(img);
  imgEl.centerAlignImage();

  w.url = URLScheme.forRunningScript();
  return w;
}

/**
 * accessoryRectangular: 複数の小さい円グラフを横並び
 * 各リングの下にラベルを表示する
 */
function buildRectangularWidget(items) {
  const w = new ListWidget();
  w.backgroundColor = C.lockBg;
  w.setPadding(0, 0, 0, 0);
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);

  const display = items.slice(0, 3);

  if (display.length === 0) {
    const t = w.addText("データなし");
    t.font = Font.regularSystemFont(10);
    t.textColor = C.lockFg;
    w.url = URLScheme.forRunningScript();
    return w;
  }

  const row = w.addStack();
  row.layoutHorizontally();
  row.centerAlignContent();

  for (let i = 0; i < display.length; i++) {
    if (i > 0) row.addSpacer(4);

    const item = display[i];
    const ringSize = 40;
    const img = drawRingSimple(
      ringSize, item.pct, item.short, 3,
      C.lockFg, C.lockDim, C.lockFg
    );
    const imgEl = row.addImage(img);
    imgEl.centerAlignImage();
  }

  w.url = URLScheme.forRunningScript();
  return w;
}

/**
 * accessoryInline: テキストのみ
 */
function buildInlineWidget(items) {
  const w = new ListWidget();
  const item = getItemByParam(items, args.widgetParameter);
  if (item) {
    const t = w.addText(`Claude: ${item.short} ${item.pct}%`);
    t.font = Font.regularSystemFont(12);
  } else {
    w.addText("Claude: --");
  }
  w.url = URLScheme.forRunningScript();
  return w;
}

// ==================== ホーム画面描画 ====================

function drawBar(width, height, pct) {
  const ctx = new DrawContext();
  ctx.size = new Size(width, height);
  ctx.opaque = false;
  ctx.respectScreenScale = true;

  const bgPath = new Path();
  bgPath.addRoundedRect(new Rect(0, 0, width, height), 3, 3);
  ctx.addPath(bgPath);
  ctx.setFillColor(C.barBg);
  ctx.fillPath();

  if (pct > 0) {
    const fillW = Math.max(6, Math.round((pct / 100) * width));
    const fgPath = new Path();
    fgPath.addRoundedRect(new Rect(0, 0, fillW, height), 3, 3);
    ctx.addPath(fgPath);
    ctx.setFillColor(barColor(pct));
    ctx.fillPath();
  }

  return ctx.getImage();
}

function addRow(container, item, barWidth, compact) {
  const row = container.addStack();
  row.layoutVertically();
  row.spacing = compact ? 1 : 2;

  // ラベル行: ラベル（左） + リセット時間（右）
  const top = row.addStack();
  top.layoutHorizontally();
  top.centerAlignContent();

  const lbl = top.addText(item.label);
  lbl.font = Font.semiboldSystemFont(compact ? 10 : 11);
  lbl.textColor = C.text;
  lbl.lineLimit = 1;

  top.addSpacer();

  if (!compact) {
    const resetStr = fmtReset(item.reset);
    if (resetStr) {
      const rt = top.addText(resetStr);
      rt.font = Font.regularSystemFont(9);
      rt.textColor = C.sub;
    }
  }

  // バー行: バー（左） + パーセント（右）
  const barRow = row.addStack();
  barRow.layoutHorizontally();
  barRow.centerAlignContent();

  const barH = compact ? 5 : 6;
  const barImg = barRow.addImage(drawBar(barWidth, barH, item.pct));
  barImg.imageSize = new Size(barWidth, barH);

  barRow.addSpacer();

  const pctText = barRow.addText(`${item.pct}% 使用済み`);
  pctText.font = Font.regularSystemFont(9);
  pctText.textColor = barColor(item.pct);
  pctText.lineLimit = 1;
}

function buildWidget(items, timestamp) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  const compact = isSmall();
  w.setPadding(compact ? 8 : 16, compact ? 10 : 18, compact ? 8 : 16, compact ? 10 : 18);
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60000);

  // ヘッダー
  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();

  const logoSize = compact ? 12 : 13;
  const logoImg = hdr.addImage(drawClaudeLogo(logoSize));
  logoImg.imageSize = new Size(logoSize, logoSize);
  hdr.addSpacer(4);

  const title = hdr.addText("Claude Usage");
  title.font = Font.boldSystemFont(compact ? 11 : 12);
  title.textColor = C.text;

  hdr.addSpacer();

  const ageLabel = fmtAge(timestamp);
  if (ageLabel) {
    const ts = hdr.addText(ageLabel);
    ts.font = Font.regularSystemFont(9);
    ts.textColor = cacheAgeColor(timestamp);
  }

  w.addSpacer(compact ? 4 : 6);

  // データ行（セクション見出し付き）
  const display = compact ? items.slice(0, 2) : items;
  const barWidth = getBarWidth();
  let lastSection = null;

  for (let i = 0; i < display.length; i++) {
    const item = display[i];

    if (!compact && item.section && item.section !== lastSection) {
      if (lastSection !== null) w.addSpacer(4);
      const sec = w.addText(item.section);
      sec.font = Font.boldSystemFont(9);
      sec.textColor = C.sub;
      w.addSpacer(2);
      lastSection = item.section;
    } else if (i > 0) {
      w.addSpacer(3);
    }

    addRow(w, item, barWidth, compact);
  }

  if (display.length === 0) {
    const noData = w.addText("データなし");
    noData.font = Font.regularSystemFont(11);
    noData.textColor = C.sub;
  }

  w.addSpacer();
  w.url = URLScheme.forRunningScript();
  return w;
}

function buildErrorWidget(errType) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);
  w.refreshAfterDate = new Date(Date.now() + ERROR_REFRESH_MINUTES * 60000);

  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();
  const ic = hdr.addText("⚠");
  ic.font = Font.boldSystemFont(14);
  hdr.addSpacer(6);
  const t = hdr.addText("Claude Usage");
  t.font = Font.boldSystemFont(13);
  t.textColor = C.text;

  w.addSpacer(8);

  const tt = w.addText(errTitle(errType));
  tt.font = Font.semiboldSystemFont(12);
  tt.textColor = C.red;

  w.addSpacer(4);
  const m = w.addText(errMessage(errType));
  m.font = Font.regularSystemFont(10);
  m.textColor = C.sub;
  m.minimumScaleFactor = 0.7;

  w.addSpacer();
  w.url = URLScheme.forRunningScript();
  return w;
}

function buildSetupWidget() {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 14, 14, 14);

  const hdr = w.addStack();
  hdr.layoutHorizontally();
  hdr.centerAlignContent();
  const logoImg = hdr.addImage(drawClaudeLogo(14));
  logoImg.imageSize = new Size(14, 14);
  hdr.addSpacer(4);
  const t = hdr.addText("Claude Usage");
  t.font = Font.boldSystemFont(14);
  t.textColor = C.accent;

  w.addSpacer(8);

  const m = w.addText("タップして初期設定");
  m.font = Font.regularSystemFont(11);
  m.textColor = C.text;

  w.addSpacer();
  w.url = URLScheme.forRunningScript();
  return w;
}

// ==================== エラー表示（アプリ内実行時） ====================

async function showErrorAlert(err) {
  const a = new Alert();
  a.title = "Claude Usage";
  a.message = "エラー: " + errMessage(err);
  a.addAction("OK");
  a.addAction("キャッシュ & orgId クリア");

  const idx = await a.presentAlert();
  if (idx === 1) {
    if (Keychain.contains(KEYCHAIN_ORG)) Keychain.remove(KEYCHAIN_ORG);
    if (fm.fileExists(cachePath)) fm.remove(cachePath);
    const done = new Alert();
    done.title = "クリア完了";
    done.message = "次回実行時に再取得します";
    done.addAction("OK");
    await done.presentAlert();
  }
}

// ==================== メイン ====================

async function main() {
  // --- ウィジェットモード ---
  if (config.runsInWidget) {
    const cached = loadFromCache();

    if (!cached.ok) {
      // ロック画面のセットアップは小さいので簡易表示
      if (isLockScreen()) {
        const w = new ListWidget();
        w.addText("--");
        w.url = URLScheme.forRunningScript();
        Script.setWidget(w);
      } else {
        Script.setWidget(buildSetupWidget());
      }
      return Script.complete();
    }

    const items = parse(cached.data);
    const family = config.widgetFamily;

    if (family === "accessoryCircular") {
      Script.setWidget(buildCircularWidget(items));
    } else if (family === "accessoryRectangular") {
      Script.setWidget(buildRectangularWidget(items));
    } else if (family === "accessoryInline") {
      Script.setWidget(buildInlineWidget(items));
    } else {
      Script.setWidget(buildWidget(items, cached.timestamp));
    }

    return Script.complete();
  }

  // --- アプリ内実行: WebView でライブ取得 ---
  const result = await fetchUsageLive();

  if (!result.ok) {
    const cached = loadFromCache();
    if (cached.ok) {
      const items = parse(cached.data);
      const w = buildWidget(items, cached.timestamp);

      const warn = new Alert();
      warn.title = "ライブ取得失敗";
      warn.message =
        "エラー: " + errMessage(result.err) + "\n\n" +
        "キャッシュデータを表示します（" + (fmtAge(cached.timestamp) || "") + "）";
      warn.addAction("OK");
      await warn.presentAlert();

      await w.presentMedium();
      return Script.complete();
    }

    const w = buildErrorWidget(result.err);
    await showErrorAlert(result.err);
    await w.presentMedium();
    return Script.complete();
  }

  // 成功
  const cache = readCache();
  const items = parse(result.data);
  const w = buildWidget(items, cache ? cache.timestamp : null);
  await w.presentMedium();
  Script.complete();
}

await main();