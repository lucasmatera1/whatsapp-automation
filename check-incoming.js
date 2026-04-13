const db = require('better-sqlite3')('./data.db');
const incoming = db.prepare("SELECT json_extract(payload, '$.phone') as phone, json_extract(payload, '$.text') as text, created_at FROM webhook_events WHERE event_type = 'incoming_message' ORDER BY created_at DESC LIMIT 20").all();
console.log('=== ULTIMAS MENSAGENS RECEBIDAS ===');
incoming.forEach(m => console.log(m.created_at, m.phone, (m.text||'[media]').substring(0,60)));

// Servidor rodando?
const http = require('http');
const req = http.get('http://localhost:3000/health', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => { console.log('\n=== SERVIDOR ==='); console.log(d); });
});
req.on('error', () => console.log('\n=== SERVIDOR === OFFLINE'));
req.setTimeout(3000);
