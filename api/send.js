// 彼此繪：客人「寄給彼此繪」的畫，用 Resend 寄到你的信箱
// 需要在 Vercel 設定的環境變數：
//   RESEND_API_KEY  必填，Resend 申請的 API 金鑰（re_ 開頭）
//   MAIL_TO         必填，收畫的信箱（要和註冊 Resend 的信箱相同），例如 bobobogate2@gmail.com
//   MAIL_FROM       選填，寄件人；沒有自己的網域時用預設的 "彼此繪 <onboarding@resend.dev>"

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const hits = new Map();
function tooMany(ip) {
  const key = new Date().toISOString().slice(0, 10) + '|' + ip;
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n > 20;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = String(process.env.RESEND_API_KEY || '').trim();
  const to = String(process.env.MAIL_TO || '').trim();
  if (!key || !to) return res.status(503).json({ error: '寄畫功能還沒設定好，請稍後再試。' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { image, name, email, note, source, letter } = body || {};

  if (typeof image !== 'string' || image.length < 100) return res.status(400).json({ error: '沒有收到畫，請再試一次。' });
  if (image.length > 4_000_000) return res.status(413).json({ error: '這張圖太大了，請換一張小一點的。' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''))) return res.status(400).json({ error: '請填一個可以收信的 Email。' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (tooMany(ip)) return res.status(429).json({ error: '今天寄太多張了，明天再寄吧。' });

  const who = String(name || '').slice(0, 40);
  const rows = [
    ['稱呼', who || '（未填）'],
    ['Email', email],
    ['想說的話', String(note || '').slice(0, 500) || '（未填）'],
    ['來源', source === 'sketch' ? '網站畫布' : '上傳'],
    ['想收每月的信', letter ? '是' : '否']
  ];
  const html = `<div style="font-family:sans-serif;line-height:1.7">
    <h2 style="margin:0 0 12px">彼此繪收到一張畫</h2>
    <table cellpadding="6" style="border-collapse:collapse">${rows.map(([k, v]) =>
      `<tr><td style="color:#666;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="white-space:pre-wrap">${esc(v)}</td></tr>`).join('')}</table>
    <p style="color:#666">畫在附件裡。直接按「回覆」就會回信給客人。</p></div>`;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || '彼此繪 <onboarding@resend.dev>',
        to: [to],
        reply_to: email,
        subject: '彼此繪：收到一張畫' + (who ? `（${who}）` : ''),
        html,
        attachments: [{ filename: 'drawing.jpg', content: image }]
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Resend error', r.status, JSON.stringify(data).slice(0, 600));
      return res.status(502).json({ error: '這次沒有寄出去，請稍後再試一次。' });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: '這次沒有寄出去，請稍後再試一次。' });
  }
}
