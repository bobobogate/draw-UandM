// 彼此繪：把客人的畫，用彼此繪的粉彩風格重畫一次（Gemini / Nano Banana）
// 需要在 Vercel 設定的環境變數：
//   GEMINI_API_KEY  必填，Google AI Studio 申請的 API 金鑰
//   ACCESS_CODE     建議填，體驗碼；可填多組，用逗號分開，例如 "SPRING26,FRIEND"
//   GEMINI_MODEL    選填，預設 gemini-3.1-flash-image（Nano Banana 2）
//   DAILY_LIMIT     選填，同一個網路位址每天最多幾次，預設 5
//   ALLOWED_ORIGIN  選填，只允許你的網址呼叫，例如 https://bicihui.vercel.app
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const STYLE_FILES = ['w4317.webp', 'w4305.webp', 'w4313.webp', 'w4316.webp', 'w4318.webp'];

const PROMPT = `The FIRST image is a drawing made by a visitor. The other images are pastel artworks by the artist of the brand "彼此繪 Draw, U & M" and are STYLE REFERENCES ONLY.

Repaint the visitor's drawing BY HAND with soft pastels, as if the artist re-drew it on textured paper. Stay faithful to the original:
- Keep exactly the same lines, shapes, composition and where each color sits. Do NOT add any new objects, figures, scenery or details that are not in the visitor's drawing. Simple drawings stay simple.
- Redraw EVERY line of the visitor's drawing itself as a real pastel stroke: chalky, slightly uneven edges, varying pressure, pigment caught in the paper grain. No smooth digital lines, no dotted or pixel-like strokes may remain.
- Keep the visitor's own line colors, only softened into pastel tones.
- Let the lines and the background melt together like one painting: gentle smudging and blending at the edges, soft layered color on the paper in the artist's palette (muted night-sky blue, apricot, sage green, small warm gold specks), calm and dreamy mood.
- The background may be softly colored, but must stay quiet and must not turn into a scene.
- Use the reference artworks only for the stroke texture, paper grain, blending and palette. Do not copy their subjects.
- No text, no letters, no signature, no frame. Not a photo, not 3D, not anime.
Return one square image.`;

// 簡單的每日次數限制（同一台伺服器實例內有效，搭配體驗碼與 Google 預算上限一起用）
const hits = new Map();
function overLimit(ip, limit) {
  const day = new Date().toISOString().slice(0, 10);
  const key = day + '|' + ip;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n > limit;
}

let styleCache = null;
async function styleParts() {
  if (styleCache) return styleCache;
  const dir = path.join(process.cwd(), 'style-refs');
  styleCache = await Promise.all(STYLE_FILES.map(async f => ({
    inlineData: { mimeType: 'image/webp', data: (await readFile(path.join(dir, f))).toString('base64') }
  })));
  return styleCache;
}

export default async function handler(req, res) {
  const allowed = process.env.ALLOWED_ORIGIN;
  if (allowed && req.headers.origin && req.headers.origin !== allowed) {
    return res.status(403).json({ error: '這個網址不能使用轉化功能。' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 去掉貼上時不小心多出的空白、換行或引號
  const key = String(process.env.GEMINI_API_KEY || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!key) return res.status(503).json({ error: '轉化功能還沒設定好，請稍後再試。' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { image, code } = body || {};

  const codes = (process.env.ACCESS_CODE || '').split(',').map(s => s.trim()).filter(Boolean);
  if (codes.length && !codes.includes(String(code || '').trim())) {
    return res.status(401).json({ error: '體驗碼不對，請再確認一次。' });
  }
  if (typeof image !== 'string' || image.length < 100) {
    return res.status(400).json({ error: '沒有收到畫，請再試一次。' });
  }
  if (image.length > 3_000_000) {
    return res.status(413).json({ error: '這張圖太大了，請換一張小一點的。' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (overLimit(ip, Number(process.env.DAILY_LIMIT) || 5)) {
    return res.status(429).json({ error: '今天的轉化次數用完了，明天再來畫吧。' });
  }

  const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-image';
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const payload = JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: PROMPT },
            { inlineData: { mimeType: 'image/jpeg', data: image } },
            ...(await styleParts())
          ]
        }],
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: '1:1' } }
    });
    // 先用標頭傳金鑰；如果被拒（401），改用網址參數再試一次
    let r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: payload
    });
    if (r.status === 401) {
      r = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      // 只記錄金鑰開頭與長度，方便檢查有沒有貼錯，不會記下整把金鑰
      console.error('Gemini error', r.status, `key=${key.slice(0, 3)}… len=${key.length}`, `model=${model}`, JSON.stringify(data).slice(0, 800));
      return res.status(502).json({ error: '這次沒有畫成功，請稍後再試一次。' });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const pic = parts.find(p => p.inlineData || p.inline_data);
    const inline = pic && (pic.inlineData || pic.inline_data);
    if (!inline?.data) {
      console.error('No image returned', JSON.stringify(data).slice(0, 800));
      return res.status(502).json({ error: '這張畫這次轉不出來，換一張或再試一次看看。' });
    }
    return res.status(200).json({ image: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '這次沒有畫成功，請稍後再試一次。' });
  }
}
