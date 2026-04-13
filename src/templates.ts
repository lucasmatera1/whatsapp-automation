import { whatsappApi } from "./whatsapp-api";
import { logger } from "./logger";

// ============================================================
// Templates pré-definidos para criação rápida via API Meta
// ============================================================

export interface TemplateDefinition {
  name: string;
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  components: any[];
  description: string;
}

/**
 * Biblioteca de templates prontos para submeter à Meta
 */
export const TEMPLATE_LIBRARY: Record<string, TemplateDefinition> = {
  // ── MARKETING ─────────────────────────────────────────
  reativacao_cliente: {
    name: "reativacao_cliente",
    category: "MARKETING",
    language: "pt_BR",
    description: "Reativação de clientes inativos com oferta",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}! 👋 Sentimos sua falta!\nTemos uma oferta especial para você: {{2}}\nResponda SIM para saber mais ou PARAR para não receber mais mensagens.",
        example: { body_text: [["João", "20% de desconto em todos os produtos"]] },
      },
      {
        type: "FOOTER",
        text: "Responda PARAR para cancelar",
      },
    ],
  },

  promocao_geral: {
    name: "promocao_geral",
    category: "MARKETING",
    language: "pt_BR",
    description: "Promoção geral com CTA",
    components: [
      {
        type: "BODY",
        text: "🔥 {{1}}, temos novidades!\n\n{{2}}\n\n⏰ Válido até {{3}}.\nAproveite! Responda PARAR para não receber mais.",
        example: { body_text: [["Maria", "Frete grátis em compras acima de R$99", "domingo"]] },
      },
      {
        type: "FOOTER",
        text: "Responda PARAR para cancelar",
      },
    ],
  },

  boas_vindas_marketing: {
    name: "boas_vindas_marketing",
    category: "MARKETING",
    language: "pt_BR",
    description: "Boas-vindas com cupom para novo cliente",
    components: [
      {
        type: "BODY",
        text: "Bem-vindo(a), {{1}}! 🎉\nQue bom ter você com a gente.\nUse o cupom {{2}} na sua primeira compra e ganhe desconto!\nResponda PARAR para cancelar.",
        example: { body_text: [["Ana", "BEMVINDO10"]] },
      },
      {
        type: "FOOTER",
        text: "Responda PARAR para cancelar",
      },
    ],
  },

  // ── UTILITY ───────────────────────────────────────────
  confirmacao_pedido: {
    name: "confirmacao_pedido",
    category: "UTILITY",
    language: "pt_BR",
    description: "Confirmação de pedido com detalhes",
    components: [
      {
        type: "BODY",
        text: "Olá! Seu pedido {{1}} foi confirmado com sucesso.\nValor: R$ {{2}}\nPrevisão de entrega: {{3}}\nObrigado pela compra!",
        example: { body_text: [["#12345", "199,90", "3 dias úteis"]] },
      },
    ],
  },

  lembrete_agendamento: {
    name: "lembrete_agendamento",
    category: "UTILITY",
    language: "pt_BR",
    description: "Lembrete de agendamento/consulta",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, lembrete do seu agendamento:\n📅 Data: {{2}}\n⏰ Horário: {{3}}\n📍 Local: {{4}}\nConfirme respondendo SIM ou reagende respondendo REAGENDAR.",
        example: { body_text: [["Carlos", "10/04/2026", "14:00", "Rua Exemplo, 123"]] },
      },
    ],
  },

  atualizacao_entrega: {
    name: "atualizacao_entrega",
    category: "UTILITY",
    language: "pt_BR",
    description: "Status de entrega atualizado",
    components: [
      {
        type: "BODY",
        text: "Atualização de entrega do seu pedido {{1}}.\nStatus atual: {{2}}\nPrevisão de chegada: {{3}}\nAcompanhe pelo nosso site.",
        example: { body_text: [["#12345", "Em trânsito", "amanhã"]] },
      },
    ],
  },

  cobranca_lembrete: {
    name: "cobranca_lembrete",
    category: "UTILITY",
    language: "pt_BR",
    description: "Lembrete de pagamento pendente",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, identificamos um pagamento pendente:\n💰 Valor: R$ {{2}}\n📅 Vencimento: {{3}}\nPague via: {{4}}\nDúvidas? Responda esta mensagem.",
        example: { body_text: [["Pedro", "150,00", "15/04/2026", "https://exemplo.com/pagar"]] },
      },
    ],
  },

  // ── AUTHENTICATION ────────────────────────────────────
  codigo_verificacao: {
    name: "codigo_verificacao",
    category: "AUTHENTICATION",
    language: "pt_BR",
    description: "Código OTP de verificação",
    components: [
      {
        type: "BODY",
        add_security_recommendation: true,
      },
      {
        type: "FOOTER",
        code_expiration_minutes: 10,
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "OTP",
            otp_type: "COPY_CODE",
            text: "Copiar código",
          },
        ],
      },
    ],
  },

  // ── MARKETING (Aquecimento) ─────────────────────────────
  aviso_funcionamento: {
    name: "aviso_funcionamento",
    category: "MARKETING",
    language: "pt_BR",
    description: "Aviso de horário de funcionamento ou mudança",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, informamos que nosso horário de atendimento será {{2}}. Para dúvidas, responda esta mensagem. Obrigado!",
        example: { body_text: [["João", "das 9h às 18h de segunda a sexta"]] },
      },
    ],
  },

  pesquisa_satisfacao: {
    name: "pesquisa_satisfacao",
    category: "UTILITY",
    language: "pt_BR",
    description: "Pesquisa de satisfação rápida",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, sua opinião é muito importante para nós! Como foi sua experiência com {{2}}? Responda de 1 a 5, sendo 5 excelente. Obrigado!",
        example: { body_text: [["Maria", "nosso atendimento"]] },
      },
    ],
  },

  notificacao_novidade: {
    name: "notificacao_novidade",
    category: "UTILITY",
    language: "pt_BR",
    description: "Notificação de novidade ou atualização do serviço",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, temos uma novidade para você! {{2}}. Quer saber mais? Responda SIM e te contamos tudo!",
        example: { body_text: [["Carlos", "Agora aceitamos pagamento via Pix"]] },
      },
    ],
  },

  notificacao_novidade_v2: {
    name: "notificacao_novidade_v2",
    category: "UTILITY",
    language: "pt_BR",
    description: "Notificação de novidade com botões Sim/Não",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, temos uma novidade para você! {{2}}. Quer saber mais?",
        example: { body_text: [["Carlos", "Agora aceitamos pagamento via Pix"]] },
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Sim, quero saber!" },
          { type: "QUICK_REPLY", text: "Não, obrigado" },
        ],
      },
    ],
  },

  confirmacao_cadastro: {
    name: "confirmacao_cadastro",
    category: "UTILITY",
    language: "pt_BR",
    description: "Confirmação de cadastro ou inscrição",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, seu cadastro foi realizado com sucesso! Seu número de registro é {{2}}. Guarde este número para futuras consultas. Bem-vindo!",
        example: { body_text: [["Ana", "REG-2026-0042"]] },
      },
    ],
  },

  lembrete_retorno: {
    name: "lembrete_retorno",
    category: "UTILITY",
    language: "pt_BR",
    description: "Lembrete de retorno ou follow-up",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, passando para lembrar sobre {{2}}. Se precisar de algo, estamos à disposição. Responda OK para confirmar!",
        example: { body_text: [["Pedro", "sua consulta agendada para amanhã às 14h"]] },
      },
    ],
  },

  agradecimento_contato: {
    name: "agradecimento_contato",
    category: "UTILITY",
    language: "pt_BR",
    description: "Agradecimento por contato ou interação",
    components: [
      {
        type: "BODY",
        text: "Olá {{1}}, agradecemos pelo seu contato! {{2}}. Qualquer dúvida, é só responder aqui. Conte sempre conosco!",
        example: { body_text: [["Lucas", "Seu atendimento foi registrado com sucesso"]] },
      },
    ],
  },
};

/**
 * Submeter um template da biblioteca para aprovação na Meta
 */
export async function submitTemplate(templateKey: string): Promise<any> {
  const template = TEMPLATE_LIBRARY[templateKey];
  if (!template) {
    const available = Object.keys(TEMPLATE_LIBRARY).join(", ");
    throw new Error(`Template "${templateKey}" não encontrado. Disponíveis: ${available}`);
  }

  logger.info(`Submetendo template "${template.name}" (${template.category})`);

  try {
    const result = await whatsappApi.createTemplate({
      name: template.name,
      category: template.category,
      language: template.language,
      components: template.components,
    });

    logger.info(`Template "${template.name}" submetido com sucesso`, { id: result.id });
    return result;
  } catch (error: any) {
    const apiError = error.response?.data?.error;
    if (apiError) {
      logger.error(`Erro API Meta ao submeter "${template.name}"`, {
        code: apiError.code,
        type: apiError.type,
        message: apiError.message,
        subcode: apiError.error_subcode,
        userMsg: apiError.error_user_msg || apiError.error_user_title,
        details: JSON.stringify(apiError.error_data),
      });
    }
    throw error;
  }
}

/**
 * Submeter todos os templates da biblioteca
 */
export async function submitAllTemplates(): Promise<{ submitted: string[]; failed: string[] }> {
  const results = { submitted: [] as string[], failed: [] as string[] };

  for (const [key, template] of Object.entries(TEMPLATE_LIBRARY)) {
    try {
      await submitTemplate(key);
      results.submitted.push(key);
      // Esperar entre submissões para não sobrecarregar
      await new Promise((r) => setTimeout(r, 2000));
    } catch (error: any) {
      const apiError = error.response?.data?.error;
      logger.error(`Falha ao submeter "${key}": ${error.message}`, {
        code: apiError?.code,
        type: apiError?.type,
        message: apiError?.message,
        fbtrace: apiError?.fbtrace_id,
        details: apiError?.error_user_msg || apiError?.error_data,
      });
      results.failed.push(key);
    }
  }

  return results;
}

/**
 * Listar todos os templates disponíveis na biblioteca local
 */
export function listLocalTemplates(): Array<{
  key: string;
  name: string;
  category: string;
  description: string;
}> {
  return Object.entries(TEMPLATE_LIBRARY).map(([key, t]) => ({
    key,
    name: t.name,
    category: t.category,
    description: t.description,
  }));
}

/**
 * Construir componentes de parâmetros para envio de template
 * Atalho para montar o array de components a partir de strings simples
 */
export function buildBodyParams(...params: string[]): Array<{
  type: "body";
  parameters: Array<{ type: "text"; text: string }>;
}> {
  return [
    {
      type: "body",
      parameters: params.map((p) => ({ type: "text", text: p })),
    },
  ];
}
