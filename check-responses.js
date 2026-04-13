const Database = require('better-sqlite3');
const db = new Database('./data.db');

console.log('=== MENSAGENS ENVIADAS (com status) ===');
const msgs = db.prepare("SELECT contact_phone, template_name, status, sent_at, delivered_at, read_at, created_at FROM messages ORDER BY created_at DESC LIMIT 30").all();
msgs.forEach(m => console.log(m.created_at, '|', m.contact_phone, '|', m.template_name, '|', m.status, '| delivered:', m.delivered_at, '| read:', m.read_at));

console.log('\n=== WEBHOOK EVENTS - MENSAGENS RECEBIDAS ===');
const events = db.prepare("SELECT event_type, payload, created_at FROM webhook_events ORDER BY created_at DESC LIMIT 80").all();
let msgCount = 0;
let statusMap = {};
events.forEach(e => {
  try {
    const p = JSON.parse(e.payload || '{}');
    const msg = p?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const contact = p?.entry?.[0]?.changes?.[0]?.value?.contacts?.[0];
    if (msg) {
      msgCount++;
      const text = msg.text?.body || msg.interactive?.button_reply?.title || `[${msg.type}]`;
      console.log(e.created_at, '| MSG DE:', contact?.profile?.name || 'desconhecido', '(', contact?.wa_id, ') |', text);
    }
    const statuses = p?.entry?.[0]?.changes?.[0]?.value?.statuses;
    if (statuses) {
      statuses.forEach(s => {
        if (!statusMap[s.recipient_id]) statusMap[s.recipient_id] = [];
        statusMap[s.recipient_id].push(s.status);
      });
    }
  } catch(err) {}
});
if (msgCount === 0) console.log('(nenhum evento com mensagem recebida)');

console.log('\n=== STATUS DE ENTREGA POR CONTATO ===');
Object.entries(statusMap).forEach(([phone, statuses]) => {
  const unique = [...new Set(statuses)];
  console.log(phone, '|', unique.join(', '));
});

console.log('\n=== CONTATOS ===');
const contacts = db.prepare("SELECT phone, name, opted_out, created_at FROM contacts ORDER BY created_at DESC LIMIT 20").all();
contacts.forEach(c => console.log(c.phone, '|', c.name, '|', c.opted_out ? 'OPT-OUT' : 'ativo'));
