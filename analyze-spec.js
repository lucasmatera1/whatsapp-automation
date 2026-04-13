const yaml = require('js-yaml');
const fs = require('fs');
const spec = yaml.load(fs.readFileSync('meta-openapi-v23.yaml', 'utf8'));

const targets = [
  '/{Version}/{Phone-Number-ID}/conversational_automation',
  '/{Version}/{Phone-Number-ID}/whatsapp_business_profile',
  '/{Version}/{Phone-Number-ID}/marketing_messages',
  '/{Version}/{Phone-Number-ID}/message_qrdls',
  '/{Version}/{WABA-ID}/flows',
  '/{Version}/{Phone-Number-ID}/block_users',
  '/{Version}/{Phone-Number-ID}/calls',
  '/{Version}/{Phone-Number-ID}/groups',
  '/{Version}/{WABA-ID}/schedules',
  '/{Version}/{Phone-Number-ID}/message_history',
  '/{Version}/{WABA-ID}/activities',
];

function resolveRef(ref) {
  if (!ref) return null;
  const parts = ref.replace('#/', '').split('/');
  let obj = spec;
  for (const p of parts) obj = obj?.[p];
  return obj;
}

function describeSchema(schema, depth = 0) {
  if (!schema) return;
  if (schema.$ref) schema = resolveRef(schema.$ref);
  if (!schema) return;
  const indent = '    '.repeat(depth);
  if (schema.properties) {
    Object.entries(schema.properties).forEach(([k, v]) => {
      const resolved = v.$ref ? resolveRef(v.$ref) : v;
      const type = resolved?.type || (resolved?.enum ? 'enum' : 'ref');
      const enumVals = resolved?.enum ? ` [${resolved.enum.join(', ')}]` : '';
      const desc = (resolved?.description || '').substring(0, 100).replace(/\n/g, ' ');
      console.log(`${indent}  - ${k} (${type}${enumVals}): ${desc}`);
    });
    if (schema.required) console.log(`${indent}  Required: ${schema.required.join(', ')}`);
  }
}

targets.forEach(path => {
  const endpoint = spec.paths[path];
  if (!endpoint) return;
  console.log('\n' + '='.repeat(70));
  console.log('ENDPOINT:', path);
  console.log('='.repeat(70));

  Object.keys(endpoint).filter(m => ['get','post','put','delete','patch'].includes(m)).forEach(method => {
    const op = endpoint[method];
    console.log('\n  ' + method.toUpperCase());
    if (op.summary) console.log('  Summary:', op.summary);
    if (op.description) console.log('  Desc:', op.description.substring(0, 200).replace(/\n/g, ' '));

    // Request body
    const content = op.requestBody?.content;
    if (content) {
      const jsonSchema = content['application/json']?.schema;
      if (jsonSchema) {
        console.log('  Request Body:');
        describeSchema(jsonSchema);
      }
    }

    // Query params
    const queryParams = (op.parameters || []).filter(p => p.in === 'query');
    if (queryParams.length) {
      console.log('  Query Params:');
      queryParams.forEach(p => {
        const desc = (p.description || '').substring(0, 80).replace(/\n/g, ' ');
        console.log(`    - ${p.name} (${p.schema?.type || '?'}) ${p.required ? 'REQUIRED' : ''} ${desc}`);
      });
    }
  });
});

// Now analyze the Conversational Automation schema deeply
console.log('\n\n' + '='.repeat(70));
console.log('DEEP: CONVERSATIONAL AUTOMATION - Full Schema');
console.log('='.repeat(70));
const caPath = spec.paths['/{Version}/{Phone-Number-ID}/conversational_automation'];
if (caPath?.post) {
  const body = caPath.post.requestBody?.content?.['application/json']?.schema;
  if (body?.$ref) {
    const schema = resolveRef(body.$ref);
    console.log('Schema name:', body.$ref.split('/').pop());
    console.log(JSON.stringify(schema, null, 2).substring(0, 3000));
  } else if (body) {
    console.log(JSON.stringify(body, null, 2).substring(0, 3000));
  }
}

// Flows schema
console.log('\n\n' + '='.repeat(70));
console.log('DEEP: FLOWS - Create Schema');
console.log('='.repeat(70));
const flowsPath = spec.paths['/{Version}/{WABA-ID}/flows'];
if (flowsPath?.post) {
  const body = flowsPath.post.requestBody?.content?.['application/json']?.schema;
  if (body?.$ref) {
    const schema = resolveRef(body.$ref);
    console.log(JSON.stringify(schema, null, 2).substring(0, 2000));
  } else if (body) {
    console.log(JSON.stringify(body, null, 2).substring(0, 2000));
  }
}

// Message types in the send messages endpoint
console.log('\n\n' + '='.repeat(70));
console.log('DEEP: SEND MESSAGES - Full capabilities');
console.log('='.repeat(70));
const msgPath = spec.paths['/{Version}/{Phone-Number-ID}/messages'];
if (msgPath?.post) {
  const body = msgPath.post.requestBody?.content?.['application/json']?.schema;
  if (body) {
    const resolved = body.$ref ? resolveRef(body.$ref) : body;
    if (resolved?.oneOf || resolved?.anyOf) {
      const options = resolved.oneOf || resolved.anyOf;
      options.forEach((opt, i) => {
        const s = opt.$ref ? resolveRef(opt.$ref) : opt;
        const name = opt.$ref ? opt.$ref.split('/').pop() : 'Option' + i;
        console.log(`\n  ${i+1}. ${name}`);
        if (s?.properties) {
          Object.keys(s.properties).forEach(k => console.log(`    - ${k}`));
        }
      });
    } else if (resolved?.properties) {
      console.log('Properties:');
      Object.entries(resolved.properties).forEach(([k, v]) => {
        const r = v.$ref ? resolveRef(v.$ref) : v;
        console.log(`  - ${k} (${r?.type || 'ref'}): ${(r?.description || '').substring(0, 100)}`);
      });
    }
  }
}

// Schedules
console.log('\n\n' + '='.repeat(70));
console.log('DEEP: SCHEDULES - Create Schema');
console.log('='.repeat(70));
const schedPath = spec.paths['/{Version}/{WABA-ID}/schedules'];
if (schedPath?.post) {
  const body = schedPath.post.requestBody?.content?.['application/json']?.schema;
  if (body?.$ref) {
    const schema = resolveRef(body.$ref);
    console.log(JSON.stringify(schema, null, 2).substring(0, 2000));
  } else if (body) {
    console.log(JSON.stringify(body, null, 2).substring(0, 2000));
  }
}

// QR Codes
console.log('\n\n' + '='.repeat(70));
console.log('DEEP: QR CODES - Create Schema');
console.log('='.repeat(70));
const qrPath = spec.paths['/{Version}/{Phone-Number-ID}/message_qrdls'];
if (qrPath?.post) {
  const body = qrPath.post.requestBody?.content?.['application/json']?.schema;
  if (body?.$ref) {
    const schema = resolveRef(body.$ref);
    console.log(JSON.stringify(schema, null, 2).substring(0, 2000));
  } else if (body) {
    console.log(JSON.stringify(body, null, 2).substring(0, 2000));
  }
}
