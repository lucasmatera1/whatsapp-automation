import { logger } from "./logger";

// ============================================================
// Motor de Variação de Conteúdo para Aquecimento
// Gera parâmetros dinâmicos e diferentes para cada envio,
// fazendo as mensagens parecerem orgânicas e naturais.
// ============================================================

/**
 * Banco de frases variadas por contexto.
 * O motor escolhe aleatoriamente para cada envio.
 */
const PHRASE_BANK = {
  // Para template: aviso_funcionamento ({{2}})
  horarios: [
    "das 8h às 18h de segunda a sexta",
    "das 9h às 17h, de segunda a sábado",
    "das 8h30 às 19h durante a semana",
    "das 9h às 18h, com intervalo das 12h às 13h",
    "das 10h às 20h de terça a sábado",
    "das 8h às 17h30, de segunda a sexta",
    "das 9h às 12h e das 14h às 18h",
    "das 8h às 18h, inclusive aos sábados",
  ],

  // Para template: pesquisa_satisfacao ({{2}})
  experiencias: [
    "nosso atendimento",
    "o serviço prestado",
    "nossa última interação",
    "o suporte que recebeu",
    "o produto adquirido",
    "a entrega realizada",
    "nosso canal de comunicação",
    "a experiência geral conosco",
  ],

  // Para template: notificacao_novidade ({{2}})
  novidades: [
    "Agora aceitamos pagamento via Pix",
    "Lançamos nosso novo catálogo online",
    "Nosso horário de atendimento foi ampliado",
    "Temos novas opções de entrega expressa",
    "Atualizamos nosso sistema de agendamento",
    "Nosso app foi atualizado com melhorias",
    "Agora você pode acompanhar pedidos em tempo real",
    "Seu suporte ficou mais rápido com nosso novo canal",
    "Implementamos pagamento parcelado sem juros",
    "Nosso programa de fidelidade está no ar",
  ],

  // Para template: confirmacao_cadastro ({{2}})
  registros: () => {
    const num = Math.floor(Math.random() * 9000) + 1000;
    const year = new Date().getFullYear();
    return `REG-${year}-${num}`;
  },

  // Para template: lembrete_retorno ({{2}})
  lembretes: [
    "sua consulta agendada para esta semana",
    "o retorno que combinamos sobre seu pedido",
    "a confirmação que ficou pendente",
    "nosso agendamento para os próximos dias",
    "o orçamento que solicitou recentemente",
    "a reunião que marcamos para breve",
    "seu atendimento de acompanhamento",
    "a documentação que precisa enviar",
  ],

  // Para template: agradecimento_contato ({{2}})
  agradecimentos: [
    "Seu atendimento foi registrado com sucesso",
    "Recebemos sua mensagem e já estamos cuidando disso",
    "Foi ótimo conversar com você hoje",
    "Sua solicitação está sendo processada",
    "Ficamos felizes com seu feedback positivo",
    "Seu contato foi muito importante para nós",
    "Sua sugestão foi encaminhada para nossa equipe",
    "Sua avaliação nos ajuda a melhorar cada vez mais",
  ],

  // Para template: confirmacao_pedido ({{1}}, {{2}}, {{3}})
  pedidos: () => ({
    numero: `#${Math.floor(Math.random() * 90000) + 10000}`,
    valor: `${(Math.random() * 400 + 50).toFixed(2).replace(".", ",")}`,
    prazo: pickRandom([
      "2 dias úteis",
      "3 dias úteis",
      "4 a 5 dias úteis",
      "até sexta-feira",
      "próxima semana",
    ]),
  }),

  // Para template: atualizacao_entrega ({{1}}, {{2}}, {{3}})
  entregas: () => ({
    numero: `#${Math.floor(Math.random() * 90000) + 10000}`,
    status: pickRandom([
      "Em separação",
      "Saiu para entrega",
      "Em trânsito",
      "Na transportadora",
      "Chegou à cidade destino",
    ]),
    previsao: pickRandom([
      "hoje até 18h",
      "amanhã",
      "em até 2 dias",
      "nesta semana",
      "até sexta-feira",
    ]),
  }),

  // Para template: lembrete_agendamento ({{2}}, {{3}}, {{4}})
  agendamentos: () => {
    const dias = Math.floor(Math.random() * 5) + 1;
    const data = new Date();
    data.setDate(data.getDate() + dias);
    const dia = data.toLocaleDateString("pt-BR");
    const horas = ["09:00", "10:30", "11:00", "14:00", "15:30", "16:00"];
    const locais = [
      "Av. Brasil, 1500 - Sala 3",
      "Rua das Flores, 230",
      "Centro Comercial, Loja 12",
      "Rua Principal, 890 - 2º andar",
      "Praça Central, 45",
    ];
    return {
      data: dia,
      horario: pickRandom(horas),
      local: pickRandom(locais),
    };
  },

  // Para template: cobranca_lembrete ({{2}}, {{3}}, {{4}})
  cobrancas: () => {
    const dias = Math.floor(Math.random() * 10) + 1;
    const venc = new Date();
    venc.setDate(venc.getDate() + dias);
    return {
      valor: `${(Math.random() * 300 + 30).toFixed(2).replace(".", ",")}`,
      vencimento: venc.toLocaleDateString("pt-BR"),
      link: "https://exemplo.com/pagar",
    };
  },

  // Saudações variadas para personalizar
  saudacoes: [
    "Olá",
    "Oi",
    "Bom dia",
    "Boa tarde",
    "E aí",
    "Tudo bem",
  ],
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================
// Tipo do plano de envio diário
// ============================================================

export interface DailyMessage {
  templateName: string;
  languageCode: string;
  category: "utility" | "marketing" | "authentication";
  generateParams: (contactName: string) => string[];
  description: string;
}

/**
 * Gera parâmetros variados para um template específico.
 * Cada chamada retorna valores diferentes.
 */
export function generateParams(templateName: string, contactName: string): string[] {
  switch (templateName) {
    case "hello_world":
      return []; // Sem parâmetros

    case "aviso_funcionamento":
      return [contactName, pickRandom(PHRASE_BANK.horarios)];

    case "pesquisa_satisfacao":
      return [contactName, pickRandom(PHRASE_BANK.experiencias)];

    case "notificacao_novidade":
      return [contactName, pickRandom(PHRASE_BANK.novidades)];

    case "confirmacao_cadastro":
      return [contactName, PHRASE_BANK.registros()];

    case "lembrete_retorno":
      return [contactName, pickRandom(PHRASE_BANK.lembretes)];

    case "agradecimento_contato":
      return [contactName, pickRandom(PHRASE_BANK.agradecimentos)];

    case "confirmacao_pedido": {
      const p = PHRASE_BANK.pedidos();
      return [p.numero, p.valor, p.prazo];
    }

    case "atualizacao_entrega": {
      const e = PHRASE_BANK.entregas();
      return [e.numero, e.status, e.previsao];
    }

    case "lembrete_agendamento": {
      const a = PHRASE_BANK.agendamentos();
      return [contactName, a.data, a.horario, a.local];
    }

    case "cobranca_lembrete": {
      const c = PHRASE_BANK.cobrancas();
      return [contactName, c.valor, c.vencimento, c.link];
    }

    case "reativacao_cliente":
      return [contactName, pickRandom([
        "20% de desconto em todos os serviços",
        "frete grátis no próximo pedido",
        "um brinde especial te esperando",
        "condições exclusivas para você",
        "desconto de 15% nesta semana",
      ])];

    case "promocao_geral":
      return [contactName, pickRandom([
        "Frete grátis em compras acima de R$99",
        "Desconto de 25% em produtos selecionados",
        "Compre 2 e leve 3 em toda a loja",
        "Cashback de 10% nesta semana",
      ]), pickRandom(["domingo", "sexta-feira", "fim do mês", "próxima terça"])];

    case "boas_vindas_marketing":
      return [contactName, pickRandom([
        "BEMVINDO10", "NOVO15", "PRIMEIRACOMPRA", "WELCOME20", "DESCONTO10",
      ])];

    default:
      return [contactName];
  }
}

/**
 * Gera o plano de disparos para um dia específico do aquecimento.
 * Distribui templates de forma variada e orgânica.
 */
export function generateDailyPlan(
  day: number,
  totalContacts: number
): DailyMessage[] {
  // Definir quais templates usar por dia (só utility na fase 1)
  const utilityTemplates: Array<{ name: string; lang: string }> = [
    { name: "hello_world", lang: "en_US" },
    { name: "aviso_funcionamento", lang: "pt_BR" },
    { name: "pesquisa_satisfacao", lang: "pt_BR" },
    { name: "notificacao_novidade", lang: "pt_BR" },
    { name: "confirmacao_cadastro", lang: "pt_BR" },
    { name: "lembrete_retorno", lang: "pt_BR" },
    { name: "agradecimento_contato", lang: "pt_BR" },
    { name: "confirmacao_pedido", lang: "pt_BR" },
    { name: "atualizacao_entrega", lang: "pt_BR" },
    { name: "lembrete_agendamento", lang: "pt_BR" },
    { name: "cobranca_lembrete", lang: "pt_BR" },
  ];

  // Quantos envios neste dia
  const sendCounts: Record<number, number> = {
    1: Math.min(10, totalContacts),
    2: Math.min(15, totalContacts),
    3: Math.min(20, totalContacts),
    4: Math.min(30, totalContacts),
    5: Math.min(35, totalContacts),
    6: Math.min(40, totalContacts),
    7: Math.min(50, totalContacts),
  };
  const count = sendCounts[day] || Math.min(50, totalContacts);

  // Distribuir templates uniformemente
  const plan: DailyMessage[] = [];
  for (let i = 0; i < count; i++) {
    const tmpl = utilityTemplates[i % utilityTemplates.length];
    plan.push({
      templateName: tmpl.name,
      languageCode: tmpl.lang,
      category: "utility",
      generateParams: (name: string) => generateParams(tmpl.name, name),
      description: `Dia ${day} - Envio ${i + 1}/${count} (${tmpl.name})`,
    });
  }

  // Embaralhar para não parecer sequencial
  for (let i = plan.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [plan[i], plan[j]] = [plan[j], plan[i]];
  }

  logger.info(`Plano do dia ${day} gerado: ${count} mensagens, ${utilityTemplates.length} templates diferentes`);
  return plan;
}
