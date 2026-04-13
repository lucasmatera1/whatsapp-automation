import { warmupManager } from "./warmup";
import { whatsappApi } from "./whatsapp-api";
import {
  importContactsFromCSV,
  getContactsByTag,
  getInactiveContacts,
  getCampaignStats,
} from "./contacts";
import { enqueueBulkMessages } from "./queue";
import { submitTemplate, submitAllTemplates, listLocalTemplates } from "./templates";
import { getScheduleInfo, fireSlotNow } from "./scheduler";
import { logger } from "./logger";

const args = process.argv.slice(2);
const command = args[0];

async function main(): Promise<void> {
  switch (command) {
    case "status": {
      const report = warmupManager.getDailyReport();
      console.log("\n📊 Status do Aquecimento:");
      console.log(`  Fase: ${report.phase}`);
      console.log(`  Enviados hoje: ${report.sentToday}/${report.dailyLimit} (${report.percentage})`);
      console.log(`  Restante: ${report.remaining}`);

      try {
        const quality = await whatsappApi.getPhoneQuality();
        console.log(`  Quality Rating: ${quality.quality_rating}`);
        console.log(`  Throughput: ${quality.throughput?.level || "N/A"}`);
        console.log(`  Verified Name: ${quality.verified_name || "N/A"}`);
      } catch {
        console.log("  Quality Rating: (não disponível)");
      }
      break;
    }

    case "check-phase": {
      const result = await warmupManager.checkPhasePromotion();
      console.log(`\n${result}`);
      break;
    }

    case "send": {
      const templateName = args[1];
      const phone = args[2];
      const params = args.slice(3);

      if (!templateName || !phone) {
        console.log("Uso: npm run send -- send <template> <telefone> [param1] [param2] ...");
        process.exit(1);
      }

      if (!warmupManager.canSendMore()) {
        console.log("❌ Limite diário atingido!");
        process.exit(1);
      }

      const contacts = [{ phone, params: params.length > 0 ? params : undefined }];
      const result = await enqueueBulkMessages(contacts, templateName, "utility");
      console.log(`\n✅ Resultado:`, result);
      break;
    }

    case "send-tag": {
      const tag = args[1];
      const templateName = args[2];

      if (!tag || !templateName) {
        console.log("Uso: npm run send -- send-tag <tag> <template>");
        process.exit(1);
      }

      const contacts = getContactsByTag(tag).map((c) => ({
        phone: c.phone,
        name: c.name,
        params: [c.name],
      }));

      console.log(`\n📋 ${contacts.length} contatos encontrados com tag "${tag}"`);

      if (contacts.length === 0) process.exit(0);

      const result = await enqueueBulkMessages(contacts, templateName, "marketing");
      console.log(`\n✅ Resultado:`, result);
      break;
    }

    case "reactivate": {
      const days = parseInt(args[1] || "30");
      const templateName = args[2];

      if (!templateName) {
        console.log("Uso: npm run send -- reactivate <dias> <template>");
        process.exit(1);
      }

      const contacts = getInactiveContacts(days).map((c) => ({
        phone: c.phone,
        name: c.name,
        params: [c.name],
      }));

      console.log(`\n📋 ${contacts.length} contatos inativos há ${days}+ dias`);

      if (contacts.length === 0) process.exit(0);

      const result = await enqueueBulkMessages(contacts, templateName, "marketing");
      console.log(`\n✅ Resultado:`, result);
      break;
    }

    case "import": {
      const filePath = args[1];
      if (!filePath) {
        console.log("Uso: npm run send -- import <caminho-csv>");
        process.exit(1);
      }

      const result = importContactsFromCSV(filePath);
      console.log(`\n✅ Importação:`, result);
      break;
    }

    case "stats": {
      const templateName = args[1];
      const stats = getCampaignStats(templateName);
      console.log("\n📈 Estatísticas:");
      console.log(`  Total: ${stats.total}`);
      console.log(`  Enviados: ${stats.sent}`);
      console.log(`  Entregues: ${stats.delivered} (${stats.deliveryRate})`);
      console.log(`  Lidos: ${stats.read} (${stats.readRate})`);
      console.log(`  Falhas: ${stats.failed}`);
      break;
    }

    case "templates": {
      const templates = await whatsappApi.listTemplates();
      console.log(`\n📝 ${templates.length} templates encontrados:\n`);
      for (const t of templates) {
        console.log(`  [${t.status}] ${t.name} (${t.category}) - ${t.language}`);
      }
      break;
    }

    case "templates-local": {
      const local = listLocalTemplates();
      console.log(`\n📝 ${local.length} templates na biblioteca local:\n`);
      for (const t of local) {
        console.log(`  [${t.category}] ${t.key} — ${t.description}`);
      }
      break;
    }

    case "submit-template": {
      const templateKey = args[1];
      if (!templateKey) {
        console.log("Uso: npm run send -- submit-template <template-key>");
        console.log("Use 'templates-local' para ver as opções.");
        process.exit(1);
      }
      const result = await submitTemplate(templateKey);
      console.log(`\n✅ Template submetido:`, result);
      break;
    }

    case "submit-all": {
      console.log("\n🚀 Submetendo todos os templates para aprovação...\n");
      const results = await submitAllTemplates();
      console.log(`\n✅ Submetidos: ${results.submitted.join(", ") || "nenhum"}`);
      if (results.failed.length > 0) {
        console.log(`❌ Falharam: ${results.failed.join(", ")}`);
      }
      break;
    }

    case "schedule": {
      const info = getScheduleInfo();
      console.log("\n⏰ Agenda de Disparos Automáticos:\n");
      for (const [i, slot] of info.entries()) {
        console.log(`  [${i}] ${slot.cron} — ${slot.description} (${slot.template})`);
      }
      break;
    }

    case "fire-slot": {
      const idx = parseInt(args[1] || "0");
      console.log(`\n⚡ Disparando slot ${idx}...`);
      const result = await fireSlotNow(idx);
      console.log(result);
      break;
    }

    default:
      console.log(`
╔══════════════════════════════════════════════════════╗
║     WhatsApp Business API - CLI                      ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Comandos disponíveis:                               ║
║                                                      ║
║  status              Ver status do aquecimento       ║
║  check-phase         Verificar promoção de fase      ║
║  send <t> <tel>      Enviar template para número     ║
║  send-tag <t> <n>    Enviar por tag de contato       ║
║  reactivate <d> <t>  Reativar inativos               ║
║  import <csv>        Importar contatos via CSV       ║
║  stats [template]    Ver estatísticas                ║
║  templates           Listar templates (Meta)         ║
║  templates-local     Listar biblioteca local         ║
║  submit-template <k> Submeter template para Meta     ║
║  submit-all          Submeter todos os templates     ║
║  schedule            Ver agenda de disparos          ║
║  fire-slot <n>       Disparar slot manualmente        ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
      `);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(err.message);
    process.exit(1);
  });
