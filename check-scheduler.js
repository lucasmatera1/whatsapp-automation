const Database = require('better-sqlite3');
const db = new Database('./data.db');
const rows = db.prepare("SELECT contact_phone, template_name, status, sent_at FROM messages WHERE created_at >= datetime('now', '-5 minutes') ORDER BY created_at DESC").all();
console.log('Nome'.padEnd(12), 'Template'.padEnd(24), 'Status'.padEnd(10), 'Enviado');
console.log('-'.repeat(70));
for (const r of rows) {
  const c = db.prepare('SELECT name FROM contacts WHERE phone = ?').get(r.contact_phone);
  console.log((c?.name || r.contact_phone).padEnd(12), r.template_name.padEnd(24), r.status.padEnd(10), r.sent_at || '-');
}
console.log('\nTotal:', rows.length, 'mensagens');
db.close();
