const db = require('better-sqlite3')('./data.db');
const fase1 = db.prepare("SELECT phone, name FROM contacts WHERE tags = 'fase1' ORDER BY name").all();
console.log('=== ALIADOS (fase1) ===');
fase1.forEach(c => {
  const msgs = db.prepare('SELECT COUNT(*) as c FROM messages WHERE contact_phone = ?').get(c.phone);
  const lastMsg = db.prepare('SELECT created_at FROM messages WHERE contact_phone = ? ORDER BY created_at DESC LIMIT 1').get(c.phone);
  const incoming = db.prepare("SELECT COUNT(*) as c FROM webhook_events WHERE event_type = 'incoming_message' AND json_extract(payload, '$.phone') = ?").get(c.phone);
  console.log(c.phone, c.name, '| env:', msgs.c, '| recebidas:', incoming.c, '| ultimo:', lastMsg ? lastMsg.created_at : 'nunca');
});
