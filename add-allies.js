const Database = require('better-sqlite3');
const db = new Database('./data.db');

const stmt = db.prepare(`INSERT INTO contacts (phone, name, tags, opted_in, opted_in_at)
  VALUES (?, ?, ?, 1, datetime('now','localtime'))
  ON CONFLICT(phone) DO UPDATE SET name = ?, tags = ?, updated_at = datetime('now','localtime')`);

const allies = [
  ['5544988292497', 'Luan'],
  ['5544988601133', 'Junior'],
  ['5544999828100', 'Fer'],
];

allies.forEach(([phone, name]) => {
  stmt.run(phone, name, 'fase1', name, 'fase1');
  console.log('Adicionado:', name, phone);
});

console.log('\nAliados fase1 atuais:');
db.prepare("SELECT phone, name, opted_out FROM contacts WHERE tags LIKE '%fase1%' ORDER BY name").all().forEach(c => {
  console.log(c.phone, '|', c.name, '|', (c.opted_out ? 'OPT-OUT' : 'ativo'));
});
