const Database = require('better-sqlite3');
const db = new Database('./data.db');
const phone = '5544988263270';
const name = 'Loja1';
const tags = 'fase1';
const existing = db.prepare('SELECT phone FROM contacts WHERE phone = ?').get(phone);
if (existing) {
  db.prepare("UPDATE contacts SET name = ?, tags = ?, opted_in = 1, updated_at = datetime('now') WHERE phone = ?").run(name, tags, phone);
  console.log('Atualizado:', phone);
} else {
  db.prepare("INSERT INTO contacts (phone, name, tags, opted_in, opted_in_at) VALUES (?, ?, ?, 1, datetime('now'))").run(phone, name, tags);
  console.log('Inserido:', phone);
}
const row = db.prepare('SELECT * FROM contacts WHERE phone = ?').get(phone);
console.log(JSON.stringify(row, null, 2));
db.close();
