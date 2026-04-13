const db = require('better-sqlite3')('./data.db');

// Messages sent
console.log('=== MENSAGENS ENVIADAS (notificacao_novidade) ===');
const sent = db.prepare("SELECT contact_phone, template_name, wamid, status, created_at FROM messages WHERE template_name = 'notificacao_novidade' ORDER BY created_at DESC").all();
sent.forEach(m => {
  const name = db.prepare('SELECT name FROM contacts WHERE phone = ?').get(m.contact_phone);
  console.log((name ? name.name : m.contact_phone), '|', m.status, '|', m.created_at);
});

// Recent incoming messages
console.log('\n=== RESPOSTAS RECEBIDAS (recentes) ===');
const events = db.prepare("SELECT event_type, payload, created_at FROM webhook_events WHERE event_type = 'incoming_message' ORDER BY created_at DESC LIMIT 20").all();
if (events.length === 0) console.log('(nenhuma)');
events.forEach(e => {
  try {
    const p = JSON.parse(e.payload);
    const name = db.prepare('SELECT name FROM contacts WHERE phone = ?').get(p.phone);
    console.log((name ? name.name : p.phone), '|', p.text || p.type, '|', e.created_at);
  } catch(err) { console.log('parse error'); }
});

// Status webhooks
console.log('\n=== STATUS UPDATES (recentes) ===');
const statuses = db.prepare("SELECT event_type, payload, created_at FROM webhook_events WHERE event_type LIKE 'status_%' ORDER BY created_at DESC LIMIT 20").all();
if (statuses.length === 0) console.log('(nenhum)');
statuses.forEach(s => {
  try {
    const p = JSON.parse(s.payload);
    console.log(p.status, '|', p.recipient_id || 'unknown', '|', s.created_at);
  } catch(err) { console.log(s.event_type, s.created_at); }
});

// Summary
console.log('\n=== RESUMO ===');
const totalSent = db.prepare("SELECT COUNT(*) as c FROM messages").get();
const totalIncoming = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE event_type = 'incoming_message'").get();
const totalStatus = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE event_type LIKE 'status_%'").get();
console.log('Total msgs enviadas:', totalSent.c);
console.log('Total msgs recebidas:', totalIncoming.c);
console.log('Total status updates:', totalStatus.c);

db.close();
