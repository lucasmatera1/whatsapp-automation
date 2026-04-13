const db = require('better-sqlite3')('./data.db');

console.log('=== BANCO DE DADOS ===');
console.log('Total mensagens:', db.prepare('SELECT COUNT(*) as c FROM messages').get().c);
console.log('Mensagens hoje:', db.prepare("SELECT COUNT(*) as c FROM messages WHERE date(created_at)=date('now','localtime')").get().c);
console.log('Contatos:', db.prepare('SELECT COUNT(*) as c FROM contacts').get().c);
console.log('Ativos:', db.prepare('SELECT COUNT(*) as c FROM contacts WHERE opted_out=0').get().c);

console.log('\n=== WARMUP LOG ===');
db.prepare('SELECT * FROM warmup_log ORDER BY date DESC LIMIT 5').all()
  .forEach(w => console.log(w.date, '- enviados:', w.sent, '- lidos:', w.read, '- falhas:', w.failed));

console.log('\n=== CONTATOS POR TAG ===');
db.prepare('SELECT tags, COUNT(*) as c FROM contacts GROUP BY tags').all()
  .forEach(t => console.log(t.tags || '(sem tag)', '-', t.c));

console.log('\n=== ULTIMAS 10 MENSAGENS ===');
db.prepare('SELECT contact_phone, template_name, body, status, created_at FROM messages ORDER BY created_at DESC LIMIT 10').all()
  .forEach(m => console.log(m.created_at, m.contact_phone, m.template_name, m.status, m.body ? m.body.substring(0, 50) : ''));

console.log('\n=== CONTATOS (LISTA) ===');
db.prepare('SELECT phone, name, tags, opted_in, opted_out FROM contacts ORDER BY name').all()
  .forEach(c => console.log(c.phone, c.name || '(sem nome)', 'tags:', c.tags || '-', c.opted_out ? 'OPT-OUT' : 'ATIVO'));
