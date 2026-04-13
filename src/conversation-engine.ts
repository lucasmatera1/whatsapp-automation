import { logger } from "./logger";

// ============================================================
// Motor de Conversação Inteligente
// Mantém contexto por contato, classifica intenção,
// gera respostas coerentes encadeadas e com persona.
// ============================================================

// ── Persona do negócio ───────────────────────────────────────
// Edite aqui para definir a identidade e o tom da conversa.
const PERSONA = {
  nomeNegocio: "Reino - Avisos",
  segmento: "assistência técnica de celulares, venda de acessórios e eletrônicos",
  tom: "amigável, prestativo e profissional, mas informal (como amigo que entende do assunto)",
  pronome: "a gente", // "nós" ou "a gente"
  horario: "segunda a sábado, das 9h às 18h",
  localizacao: "Maringá - PR",
  servicos: [
    "Conserto de tela e display",
    "Troca de bateria",
    "Reparo de placa",
    "Venda de capinhas e películas",
    "Venda de carregadores e fones",
    "Acessórios em geral",
    "Desbloqueio e configuração",
  ],
  diferenciais: [
    "Atendimento rápido e honesto",
    "Garantia nos serviços",
    "Orçamento sem compromisso",
  ],
};

// ── Tipos ────────────────────────────────────────────────────
interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

interface ConversationContext {
  messages: ConversationMessage[];
  detectedIntents: string[];
  lastReplyAt: number;
  mood: "positive" | "neutral" | "negative" | "unknown";
  awaitingInfo: string | null; // se estamos esperando algo do usuário
  mentionedTopics: Set<string>;
}

type Intent =
  | "greeting"
  | "farewell"
  | "thanks"
  | "question_price"
  | "question_service"
  | "question_hours"
  | "question_location"
  | "question_generic"
  | "interest"
  | "complaint"
  | "compliment"
  | "confirmation"
  | "negation"
  | "opt_out"
  | "audio_or_media"
  | "short_response"
  | "generic";

// ── Memória de conversas por contato ─────────────────────────
const conversations = new Map<string, ConversationContext>();
const MAX_HISTORY = 12; // Últimas 12 mensagens mantidas
const CONTEXT_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4h sem interação = reset

function getOrCreateContext(phone: string): ConversationContext {
  let ctx = conversations.get(phone);
  if (!ctx || Date.now() - ctx.lastReplyAt > CONTEXT_EXPIRY_MS) {
    ctx = {
      messages: [],
      detectedIntents: [],
      lastReplyAt: 0,
      mood: "unknown",
      awaitingInfo: null,
      mentionedTopics: new Set(),
    };
    conversations.set(phone, ctx);
  }
  return ctx;
}

function addMessage(ctx: ConversationContext, role: "user" | "assistant", text: string): void {
  ctx.messages.push({ role, text, timestamp: Date.now() });
  if (ctx.messages.length > MAX_HISTORY) {
    ctx.messages = ctx.messages.slice(-MAX_HISTORY);
  }
}

// ── Classificação de intenção ────────────────────────────────
const INTENT_PATTERNS: Array<{ intent: Intent; patterns: RegExp[] }> = [
  {
    intent: "greeting",
    patterns: [
      /^(oi|olá|ola|hey|hello|hi|eai|e aí|e ai|fala|salve|bom dia|boa tarde|boa noite|tudo bem|como vai|tudo certo)\b/i,
      /^(oii+|oie|oieee)/i,
    ],
  },
  {
    intent: "farewell",
    patterns: [
      /\b(tchau|até mais|até logo|flw|falou|bye|adeus|boa noite.*dorm|vou indo|fui)\b/i,
    ],
  },
  {
    intent: "thanks",
    patterns: [
      /\b(obrigad[oa]|valeu|vlw|thanks|agradeço|gratidão|grato|grata|brigadão|brigadinha)\b/i,
    ],
  },
  {
    intent: "question_price",
    patterns: [
      /\b(quanto custa|qual.*preço|qual.*valor|preço|valor|orçamento|orcamento|tabela|custa quanto|quanto fica|quanto sai|quanto é|quanto cobram)\b/i,
    ],
  },
  {
    intent: "question_service",
    patterns: [
      /\b(consert|arrum|troc|reparo|repar[ao]|assistência|acessório|capinha|película|pelicula|carregador|fone|bateria|tela|display|placa|desbloqu|configur|formata)\b/i,
    ],
  },
  {
    intent: "question_hours",
    patterns: [
      /\b(horário|horario|hora.*funciona|abr[ei]|fecha|aberto|horarios|horários|funciona.*hora|atende.*hora|que horas|expediente)\b/i,
    ],
  },
  {
    intent: "question_location",
    patterns: [
      /\b(onde fica|endereço|endereco|localiza|como chego|localizaç|onde é|onde vocês?|mapa|perto de|rua|avenida|bairro)\b/i,
    ],
  },
  {
    intent: "interest",
    patterns: [
      /\b(quero|tenho interesse|me conta|pode me|me fala|gostaria|preciso|necessito|to precisando|tô precisando|me ajud|como faço|como funciona)\b/i,
    ],
  },
  {
    intent: "complaint",
    patterns: [
      /\b(reclam|insatisf|péssim|pessim|horrível|horrivel|demor|absurdo|vergonha|desrespeito|lixo|porcaria|merda|droga)\b/i,
    ],
  },
  {
    intent: "compliment",
    patterns: [
      /\b(parabeniz|parabéns|excelente|ótimo|otimo|incrível|incrivel|amei|adorei|maravilh|top|show|muit[oa] bom|sensacional|nota 10|perfeito)\b/i,
    ],
  },
  {
    intent: "confirmation",
    patterns: [
      /^(sim|ss|sss|isso|isso mesmo|exato|com certeza|claro|pode ser|bora|vamo|vamos|ok|blz|beleza|fechou|combinado|certo|aham|uhum)/i,
    ],
  },
  {
    intent: "negation",
    patterns: [
      /^(não|nao|nn|nah|nope|negativo|ainda não|agora não|depois|talvez|vou pensar)/i,
    ],
  },
  {
    intent: "opt_out",
    patterns: [
      /\b(me tir[ae]|tira (eu|meu|o meu)|remove|remov[ae]|me remov[ae]|me exclu[ií]|me delet[ae])\b.*\b(list|grupo|cadastr|aqui|daqui|dessa|desse|número|contato)\b/i,
      /\b(sair|sa[ií]r|quero sair|não quero mais|nao quero mais|para de|pare de|parar de)\b.*\b(receber|mandar|enviar|mensag|lista|grupo|notificaç|notificac)\b/i,
      /\b(me tira|me tire|tira eu|me remove|me remova|me exclui|me exclua|sai dessa|sair dessa)\b/i,
      /\b(não me mand[ae]|nao me mand[ae]|não envi[ae]|nao envi[ae])\b.*\b(mais|nada|mensag)\b/i,
      /\b(descadastrar|descadastra|opt.?out|unsubscribe|parar|stop|cancelar)\b/i,
    ],
  },
  {
    intent: "audio_or_media",
    patterns: [/^\[(audio|imagem|video|documento|figurinha|sticker|location)\]$/i],
  },
  {
    intent: "short_response",
    patterns: [/^.{1,3}$/], // mensagens muito curtas (1-3 chars)
  },
];

function classifyIntent(text: string): Intent[] {
  const intents: Intent[] = [];
  const trimmed = text.trim();

  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(trimmed))) {
      intents.push(intent);
    }
  }

  // Se tem "?" e nenhuma intenção de pergunta específica
  if (trimmed.includes("?") && !intents.some((i) => i.startsWith("question_"))) {
    intents.push("question_generic");
  }

  if (intents.length === 0) intents.push("generic");
  return intents;
}

// ── Detecção de humor ────────────────────────────────────────
function detectMood(text: string): "positive" | "neutral" | "negative" {
  const lower = text.toLowerCase();
  const positiveWords = /\b(bom|boa|ótimo|otimo|legal|massa|show|top|adorei|amei|maravilh|excelent|obrigad|valeu|😊|😄|🙌|👍|❤️|😍|🥰|💪|✅)\b/;
  const negativeWords = /\b(ruim|péssim|pessim|horrível|horrivel|triste|chateado|raiva|irritad|demor|bravo|insatisf|pior|terrível|😡|😤|😠|💢|👎)\b/;

  if (positiveWords.test(lower)) return "positive";
  if (negativeWords.test(lower)) return "negative";
  return "neutral";
}

// ── Detectar tópicos mencionados ─────────────────────────────
function detectTopics(text: string): string[] {
  const topics: string[] = [];
  const lower = text.toLowerCase();

  const topicMap: Record<string, RegExp> = {
    tela: /\b(tela|display|visor|quebr.*tela|trincad)\b/,
    bateria: /\b(bateria|carrega|não liga|desliga sozinho|esquenta)\b/,
    acessorios: /\b(capinha|capa|película|pelicula|carregador|fone|cabo|adaptador)\b/,
    preco: /\b(preço|valor|quanto|custa|orçamento|orcamento|barato|caro|desconto|promoção|promoçao)\b/,
    prazo: /\b(prazo|quanto tempo|demora|quando fica|tempo.*conserto|dias|horas)\b/,
    garantia: /\b(garantia|garantir|defeito|problema.*depois|voltou.*defeito)\b/,
    modelo: /\b(iphone|samsung|galaxy|motorola|moto g|xiaomi|redmi|poco|huawei|lg|nokia|pixel)\b/i,
    placa: /\b(placa|chip|software|sistema|travando|lento|reiniciando)\b/,
  };

  for (const [topic, regex] of Object.entries(topicMap)) {
    if (regex.test(lower)) topics.push(topic);
  }
  return topics;
}

// ── Gerador de resposta contextual ───────────────────────────
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

interface ReplyResult {
  text: string;
  shouldAskFollowUp: boolean;
}

export function generateReply(phone: string, name: string, incomingText: string): ReplyResult {
  const ctx = getOrCreateContext(phone);
  const firstName = name.split(" ")[0] || "";
  const g = firstName || ""; // greeting name
  const intents = classifyIntent(incomingText);
  const mood = detectMood(incomingText);
  const topics = detectTopics(incomingText);

  // Atualizar contexto
  addMessage(ctx, "user", incomingText);
  ctx.detectedIntents.push(...intents);
  ctx.mood = mood;
  for (const t of topics) ctx.mentionedTopics.add(t);

  const isFirstMessage = ctx.messages.filter((m) => m.role === "user").length <= 1;
  const hasHistory = ctx.messages.length > 2;
  const primary = intents[0];

  let reply = "";
  let shouldAskFollowUp = false;

  // ── Respostas por intenção primária ──────────────────────
  if (intents.includes("opt_out")) {
    // Opt-out detectado — sinalizar para o webhook tratar
    reply = "__OPT_OUT__";
    addMessage(ctx, "assistant", "[opt-out solicitado]");
    ctx.lastReplyAt = Date.now();
    logger.info(`ConversationEngine: OPT-OUT detectado para ${phone}. intents=[${intents}]`);
    return { text: reply, shouldAskFollowUp: false };
  } else if (primary === "greeting") {
    if (isFirstMessage) {
      reply = pickRandom([
        `Oi ${g}! 😊 Seja bem-vindo(a) à ${PERSONA.nomeNegocio}! Como posso te ajudar hoje?`,
        `Olá ${g}! Que bom que entrou em contato com ${PERSONA.pronome}! Precisa de algum serviço ou está procurando algo?`,
        `E aí ${g}! Bem-vindo(a) à ${PERSONA.nomeNegocio}! 🙌 Trabalhamos com ${PERSONA.segmento}. Em que posso ajudar?`,
        `Oi ${g}! Tudo bem? Aqui é da ${PERSONA.nomeNegocio}! Me conta como posso te ajudar 😄`,
      ]);
    } else {
      reply = pickRandom([
        `Oi ${g}! Que bom te ver de novo por aqui! 😊 Precisa de algo?`,
        `Fala ${g}! Tudo certo? Em que posso ajudar dessa vez?`,
        `Olá de novo, ${g}! Estamos aqui pra te ajudar! O que precisa?`,
      ]);
    }
    shouldAskFollowUp = false;
  } else if (primary === "farewell") {
    reply = pickRandom([
      `Até mais, ${g}! Qualquer coisa, estamos aqui. Abraço! 👋`,
      `Tchau ${g}! Foi bom conversar. Precisando, é só chamar! 😊`,
      `Valeu ${g}! Até a próxima! A ${PERSONA.nomeNegocio} tá sempre aqui pra te ajudar 🤝`,
    ]);
    ctx.awaitingInfo = null;
  } else if (primary === "thanks") {
    const extras = hasHistory
      ? [
          `${g}, imagina! Qualquer outra dúvida, pode mandar 😊`,
          `Disponha, ${g}! Estamos aqui sempre que precisar 🤝`,
          `Por nada! Se surgir qualquer outra coisa, é só chamar 😄`,
        ]
      : [
          `Obrigado a você, ${g}! Precisando de algo, estamos aqui! 😊`,
          `Nós que agradecemos o contato, ${g}! Qualquer coisa, manda mensagem 🙌`,
        ];
    reply = pickRandom(extras);
  } else if (primary === "question_price") {
    const topicCtx = topics.length > 0 ? topics : [...ctx.mentionedTopics];
    if (topicCtx.includes("tela") || topicCtx.includes("bateria") || topicCtx.includes("placa")) {
      reply = pickRandom([
        `${g}, pra te passar o valor certinho, preciso saber o modelo do seu celular. Qual é? 📱`,
        `Claro! O preço varia conforme o modelo. Me diz qual celular é que te passo um orçamento rapidinho! 😊`,
        `Boa pergunta, ${g}! Me fala o modelo do aparelho que verifico o valor na hora pra você!`,
      ]);
      ctx.awaitingInfo = "modelo_aparelho";
    } else if (topicCtx.includes("acessorios")) {
      reply = pickRandom([
        `Nossos acessórios têm preço bem acessível, ${g}! Que tipo de acessório procura? Capinha, película, carregador...? 😊`,
        `${g}, temos bastante variedade! Me diz o que precisa e o modelo do celular que te dou o valor! 📱`,
      ]);
      ctx.awaitingInfo = "tipo_acessorio";
    } else {
      reply = pickRandom([
        `${g}, claro! Pra te dar um orçamento, me conta o que precisa: conserto, acessório ou outro serviço? 😊`,
        `Me fala mais detalhes, ${g}! O que você está precisando? Assim te passo o valor certinho!`,
      ]);
      ctx.awaitingInfo = "detalhes_servico";
    }
    shouldAskFollowUp = false;
  } else if (primary === "question_service") {
    const serviceTopics = topics.filter((t) => ["tela", "bateria", "placa", "acessorios"].includes(t));
    if (serviceTopics.includes("tela")) {
      reply = pickRandom([
        `Sim, ${g}, ${PERSONA.pronome} faz troca de tela! 🔧 Qual o modelo do seu celular? Assim te passo o valor e o prazo.`,
        `Trocamos tela sim! Me diz o modelo que verifico disponibilidade na hora, ${g}! 📱`,
      ]);
      ctx.awaitingInfo = "modelo_aparelho";
    } else if (serviceTopics.includes("bateria")) {
      reply = pickRandom([
        `Fazemos troca de bateria sim, ${g}! 🔋 Qual o modelo do aparelho? Geralmente fica pronto no mesmo dia!`,
        `Claro! Troca de bateria é um dos serviços mais rápidos. Me passa o modelo que te dou o valor! ⚡`,
      ]);
      ctx.awaitingInfo = "modelo_aparelho";
    } else if (serviceTopics.includes("acessorios")) {
      reply = pickRandom([
        `Temos sim, ${g}! 🎧 Capinhas, películas, carregadores, fones... O que está procurando?`,
        `Claro! Trabalhamos com vários acessórios. Me diz o modelo do celular e o que precisa que ${PERSONA.pronome} te ajuda! 😊`,
      ]);
    } else {
      reply = pickRandom([
        `${g}, ${PERSONA.pronome} trabalha com ${PERSONA.segmento}. Me conta o que seu celular tá apresentando que te indico o melhor caminho! 🔧`,
        `Nossos serviços incluem: ${PERSONA.servicos.slice(0, 4).join(", ")} e mais! O que você precisa, ${g}? 😊`,
      ]);
    }
    shouldAskFollowUp = false;
  } else if (primary === "question_hours") {
    reply = pickRandom([
      `Nosso horário é ${PERSONA.horario}, ${g}! Pode vir quando quiser dentro desse período 😊`,
      `${g}, funcionamos ${PERSONA.horario}. Quer agendar um horário pra vir?`,
      `Estamos abertos ${PERSONA.horario}! Se quiser, me avisa que dia pretende vir que te ajudo, ${g}! 📅`,
    ]);
    shouldAskFollowUp = true;
  } else if (primary === "question_location") {
    reply = pickRandom([
      `Estamos em ${PERSONA.localizacao}, ${g}! Quer que te mande a localização certinha? 📍`,
      `${g}, a ${PERSONA.nomeNegocio} fica em ${PERSONA.localizacao}. Posso te enviar o endereço completo se quiser!`,
      `Ficamos em ${PERSONA.localizacao}! Quando quiser vir, me avisa que te explico como chegar 😊`,
    ]);
  } else if (primary === "interest") {
    if (ctx.awaitingInfo) {
      // Continuação de conversa - provavelmente respondendo algo que pedimos
      reply = handleAwaitingInfo(ctx, incomingText, g);
    } else {
      reply = pickRandom([
        `Legal, ${g}! Me conta mais: o que você está precisando exatamente? 😊`,
        `Ótimo! Pra te ajudar da melhor forma, me diz: é conserto, acessório ou outra coisa?`,
        `Show, ${g}! Me fala mais detalhes que te ajudo rapidinho! 🚀`,
      ]);
      shouldAskFollowUp = false;
    }
  } else if (primary === "complaint") {
    reply = pickRandom([
      `${g}, sinto muito que tenha tido essa experiência 😔 Me conta melhor o que aconteceu que quero resolver isso pra você!`,
      `Poxa, ${g}, lamento saber disso. Pode me dizer mais detalhes? Vou fazer o possível pra resolver pra você!`,
      `${g}, entendo sua frustração e peço desculpas. Me explica a situação que vou buscar a melhor solução 🙏`,
    ]);
    ctx.awaitingInfo = "detalhes_reclamacao";
  } else if (primary === "compliment") {
    reply = pickRandom([
      `Que bom ler isso, ${g}! 😍 É isso que nos motiva! Obrigado pelo carinho!`,
      `Muito obrigado, ${g}! Seu feedback positivo é muito importante pra ${PERSONA.pronome} 🙌`,
      `${g}, fico muito feliz! Pode contar sempre com ${PERSONA.pronome}! ❤️`,
    ]);
  } else if (primary === "confirmation") {
    if (ctx.awaitingInfo) {
      reply = handleAwaitingInfo(ctx, incomingText, g);
    } else {
      reply = pickRandom([
        `Perfeito, ${g}! Me diz como posso te ajudar então? 😊`,
        `Ótimo! Precisa de mais alguma coisa, ${g}?`,
        `Show! Se tiver mais alguma dúvida, é só falar! 😄`,
      ]);
    }
  } else if (primary === "negation") {
    if (ctx.awaitingInfo) {
      reply = pickRandom([
        `Tudo bem, ${g}! Sem problemas. Se mudar de ideia, é só chamar 😊`,
        `Ok, ${g}! Fico à disposição aqui. Qualquer coisa, manda mensagem!`,
      ]);
      ctx.awaitingInfo = null;
    } else {
      reply = pickRandom([
        `Entendi, ${g}! Se precisar de algo depois, estamos aqui! 😊`,
        `Tudo bem! Quando precisar, é só mandar mensagem 👍`,
      ]);
    }
  } else if (primary === "audio_or_media") {
    reply = pickRandom([
      `Recebi, ${g}! Vou dar uma olhada. Me dá um minutinho! 😊`,
      `Opa, vi aqui, ${g}! Posso ajudar com algo mais sobre isso?`,
      `${g}, vi sua mensagem! Me conta um pouco mais sobre o que precisa 😊`,
    ]);
  } else if (primary === "short_response") {
    // Mensagens muito curtas como "k", "s", "n"
    if (ctx.awaitingInfo) {
      reply = handleAwaitingInfo(ctx, incomingText, g);
    } else {
      reply = pickRandom([
        `${g}, precisa de algo? Estou aqui! 😊`,
        `Oi ${g}! Me conta como posso te ajudar!`,
      ]);
    }
  } else if (primary === "question_generic") {
    reply = pickRandom([
      `Boa pergunta, ${g}! Vou verificar isso pra você. Já te retorno! 👍`,
      `${g}, anotei sua dúvida! Vou checar e já te respondo direitinho 😊`,
      `Entendi, ${g}! Me dá um momentinho que trago a informação pra você!`,
    ]);
  } else {
    // Contexto-aware: se temos awaitingInfo, tratar como resposta
    if (ctx.awaitingInfo) {
      reply = handleAwaitingInfo(ctx, incomingText, g);
    } else if (topics.length > 0) {
      // Mensagem mencionou um tópico relevante
      reply = handleTopicMention(topics, g);
    } else {
      reply = pickRandom([
        `${g}, recebi sua mensagem! Precisa de algum serviço ou tem alguma dúvida? 😊`,
        `Oi ${g}! Aqui é da ${PERSONA.nomeNegocio}. Como posso te ajudar? 🔧`,
        `Recebi, ${g}! Me fala um pouco mais sobre o que precisa que te ajudo! 😄`,
        `${g}, estou aqui pra te ajudar! É sobre conserto, acessórios ou outra coisa?`,
      ]);
    }
  }

  // Adicionar follow-up natural se contexto pede
  if (shouldAskFollowUp && !reply.includes("?")) {
    reply += pickRandom([
      " Precisa de mais alguma coisa?",
      " Posso ajudar com algo mais?",
      " Tem mais alguma dúvida?",
    ]);
  }

  // Registrar resposta no contexto
  addMessage(ctx, "assistant", reply);
  ctx.lastReplyAt = Date.now();

  logger.info(`ConversationEngine: intents=[${intents}] mood=${mood} topics=[${topics}] awaiting=${ctx.awaitingInfo}`);

  return { text: reply, shouldAskFollowUp };
}

// ── Tratar respostas quando estamos esperando informação ─────
function handleAwaitingInfo(ctx: ConversationContext, text: string, name: string): string {
  const awaiting = ctx.awaitingInfo;
  ctx.awaitingInfo = null; // Reset

  const modelMatch = text.match(/\b(iphone\s*\d+\s*\w*|galaxy\s*\w+|moto\s*\w+|redmi\s*\w+|poco\s*\w+|samsung\s*\w+|xiaomi\s*\w+|pixel\s*\d*)\b/i);

  if (awaiting === "modelo_aparelho") {
    if (modelMatch) {
      const modelo = modelMatch[0];
      ctx.mentionedTopics.add("modelo:" + modelo.toLowerCase());
      return pickRandom([
        `${modelo}, ótima escolha! ${name}, vou verificar o valor certinho pra esse modelo. Em instantes te retorno! 🔍`,
        `Perfeito, ${name}! Anotei aqui: ${modelo}. Já já te passo o orçamento! 📋`,
        `${modelo}, certo! ${name}, vou consultar aqui e já te mando o valor e o prazo. Um momentinho! ⏱️`,
      ]);
    } else {
      return pickRandom([
        `${name}, me fala o modelo certinho do celular (ex: iPhone 14, Galaxy S23, Moto G54...) que consigo te passar o valor! 📱`,
        `Qual o modelo exato do aparelho, ${name}? Assim consigo consultar o preço direitinho! 😊`,
      ]);
    }
  } else if (awaiting === "tipo_acessorio") {
    return pickRandom([
      `Anotado, ${name}! Vou separar as opções pra você. Te mando as informações em breve! 😊`,
      `Show, ${name}! Já verifico a disponibilidade e te passo os valores! 👍`,
    ]);
  } else if (awaiting === "detalhes_servico") {
    if (modelMatch || text.length > 10) {
      return pickRandom([
        `Entendi, ${name}! Com base no que me falou, vou montar um orçamento pra você. Te retorno rapidinho! 📋`,
        `Perfeito, ${name}! Anotei tudo. Já já te mando o valor e o prazo! 🚀`,
      ]);
    } else {
      return pickRandom([
        `${name}, pode me dar um pouco mais de detalhes? Qual celular é e o que ele tá apresentando? 🤔`,
        `Me conta um pouco mais, ${name}! Qual o modelo e qual o problema? Assim consigo te ajudar melhor! 😊`,
      ]);
    }
  } else if (awaiting === "detalhes_reclamacao") {
    return pickRandom([
      `Entendi o problema, ${name}. Vou encaminhar isso pra resolver o mais rápido possível. Obrigado pela paciência! 🙏`,
      `${name}, anotei tudo. Vamos resolver isso pra você! Te dou um retorno assim que possível 👍`,
    ]);
  }

  // Fallback
  return pickRandom([
    `Entendi, ${name}! Obrigado pela informação. Precisa de mais algo? 😊`,
    `Anotado, ${name}! Qualquer outra dúvida, é só falar!`,
  ]);
}

// ── Tratar menção de tópicos sem intenção clara ──────────────
function handleTopicMention(topics: string[], name: string): string {
  if (topics.includes("tela")) {
    return pickRandom([
      `${name}, tá com problema na tela? ${PERSONA.pronome} resolve! Me diz o modelo do celular que te passo o valor 🔧`,
      `Vi que mencionou a tela! ${name}, quer um orçamento de troca? Me manda o modelo do aparelho! 📱`,
    ]);
  }
  if (topics.includes("bateria")) {
    return pickRandom([
      `Problema de bateria, ${name}? Fazemos troca! Qual é o modelo do celular? ⚡`,
      `${name}, bateria fraca é muito chato né? Me diz o modelo que te passo o valor da troca! 🔋`,
    ]);
  }
  if (topics.includes("modelo")) {
    return pickRandom([
      `${name}, o que precisa pro seu celular? Conserto, acessório...? Me conta! 😊`,
      `Vi que mencionou o modelo! ${name}, é conserto ou está procurando algum acessório?`,
    ]);
  }
  if (topics.includes("prazo")) {
    return pickRandom([
      `${name}, o prazo depende do serviço! A maioria dos consertos fica pronto no mesmo dia. O que precisa fazer?`,
      `Normalmente é super rápido, ${name}! Me diz qual serviço quer que te passo o prazo certinho ⏱️`,
    ]);
  }
  if (topics.includes("garantia")) {
    return pickRandom([
      `${name}, todos os nossos serviços têm garantia! Me conta o que aconteceu que te ajudo 🛡️`,
      `Sim, damos garantia nos serviços! ${name}, está com algum problema no reparo que fez com ${PERSONA.pronome}?`,
    ]);
  }
  // Fallback tópico
  return pickRandom([
    `${name}, vi que mencionou algo interessante! Me conta mais detalhes que te ajudo! 😊`,
    `Entendi, ${name}! Pode me dar mais detalhes sobre o que precisa? Vou te ajudar da melhor forma!`,
  ]);
}

// ── Exportar persona para uso externo ────────────────────────
export { PERSONA };

// ── Limpar conversas expiradas (garbage collection) ──────────
setInterval(() => {
  const now = Date.now();
  for (const [phone, ctx] of conversations) {
    if (now - ctx.lastReplyAt > CONTEXT_EXPIRY_MS) {
      conversations.delete(phone);
    }
  }
}, 30 * 60 * 1000); // A cada 30min
