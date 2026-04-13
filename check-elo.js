const Database = require('better-sqlite3');
const db = new Database('./data.db');

console.log('=== MENSAGENS PARA ELO ===');
const msgs = db.prepare('SELECT * FROM messages WHERE contact_phone = ? ORDER BY created_at').all('5544999278281');
for (const m of msgs) console.log(m.template_name, '|', m.status, '|', m.created_at, '|', m.sent_at, '| wamid:', (m.wamid||'').slice(-20));

console.log('\n=== WEBHOOKS DA ELO (incoming + status) ===');
const allEvts = db.prepare("SELECT * FROM webhook_events ORDER BY created_at").all();
for (const e of allEvts) {
  try {
    const p = JSON.parse(e.payload);
    const changes = p.entry?.[0]?.changes?.[0]?.value;
    if (changes?.messages) {
      const msg = changes.messages[0];
      const from = msg.from;
      if (from === '5544999278281' || from === '554499927828') {
        console.log('INCOMING |', e.created_at, '|', msg.type, '|', msg.text?.body || msg.button?.text || '(midia)');
      }
    }
    if (changes?.statuses) {
      const s = changes.statuses[0];
      if (s.recipient_id === '5544999278281') {
        console.log('STATUS   |', e.created_at, '|', s.status, '|', s.errors?.[0]?.title || '');
      }
    }
  } catch {}
}

db.close();
