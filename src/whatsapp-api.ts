import axios, { AxiosInstance } from "axios";
import FormData from "form-data";
import { config } from "./config";
import { logger } from "./logger";

const API_VERSION = "v23.0";
const BASE_URL = `https://graph.facebook.com/${API_VERSION}`;

// ========================
// Circuit Breaker
// ========================
enum CircuitState {
  CLOSED = "CLOSED",       // Normal: requests passam
  OPEN = "OPEN",           // Bloqueado: requests rejeitados
  HALF_OPEN = "HALF_OPEN", // Teste: 1 request de teste
}

class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(failureThreshold = 5, resetTimeoutMs = 60_000) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  canExecute(): boolean {
    if (this.state === CircuitState.CLOSED) return true;

    if (this.state === CircuitState.OPEN) {
      // Verificar se é hora de tentar novamente
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        logger.info("Circuit breaker → HALF_OPEN (tentando reconexão)");
        return true;
      }
      return false;
    }

    // HALF_OPEN: permitir 1 tentativa
    return true;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.info("Circuit breaker → CLOSED (Meta API respondendo)");
    }
    this.failureCount = 0;
    this.state = CircuitState.CLOSED;
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      logger.warn("Circuit breaker → OPEN (falha no teste de reconexão)");
      return;
    }

    if (this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      logger.error(`Circuit breaker → OPEN (${this.failureCount} falhas consecutivas). Meta API bloqueada por ${this.resetTimeoutMs / 1000}s`);
    }
  }

  getState(): { state: string; failures: number } {
    return { state: this.state, failures: this.failureCount };
  }
}

export interface TemplateComponent {
  type: "header" | "body" | "button";
  parameters: Array<{
    type: "text" | "image" | "document" | "video";
    text?: string;
    image?: { link: string };
  }>;
}

export interface SendTemplatePayload {
  to: string;
  templateName: string;
  languageCode?: string;
  components?: TemplateComponent[];
}

export interface SendTextPayload {
  to: string;
  body: string;
  previewUrl?: boolean;
}

export interface MessageResponse {
  messaging_product: string;
  contacts: Array<{ input: string; wa_id: string }>;
  messages: Array<{ id: string }>;
}

export interface PhoneNumberQuality {
  quality_rating: "GREEN" | "YELLOW" | "RED";
  display_phone_number?: string;
  verified_name?: string;
  throughput?: { level: string };
  platform_type?: string;
  code_verification_status?: string;
}

class WhatsAppAPI {
  private client: AxiosInstance;
  private circuitBreaker: CircuitBreaker;

  constructor() {
    this.circuitBreaker = new CircuitBreaker(5, 60_000);
    this.client = axios.create({
      baseURL: BASE_URL,
      headers: {
        Authorization: `Bearer ${config.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });
  }

  /**
   * Verificar circuit breaker antes de cada chamada
   */
  private ensureCircuitClosed(): void {
    if (!this.circuitBreaker.canExecute()) {
      const state = this.circuitBreaker.getState();
      throw new Error(`Meta API indisponível (circuit breaker ${state.state}, ${state.failures} falhas). Tente novamente em breve.`);
    }
  }

  /**
   * Obter estado do circuit breaker
   */
  getCircuitBreakerState(): { state: string; failures: number } {
    return this.circuitBreaker.getState();
  }

  /**
   * Enviar mensagem usando template aprovado (para iniciar conversa)
   */
  async sendTemplate(payload: SendTemplatePayload): Promise<MessageResponse> {
    this.ensureCircuitClosed();
    const { to, templateName, languageCode = "pt_BR", components } = payload;

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      to: this.formatPhone(to),
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components && { components }),
      },
    };

    try {
      const response = await this.client.post<MessageResponse>(
        `/${config.PHONE_NUMBER_ID}/messages`,
        body
      );
      this.circuitBreaker.recordSuccess();
      logger.info(`Template enviado para ${to}`, {
        template: templateName,
        wamid: response.data.messages?.[0]?.id,
      });
      return response.data;
    } catch (error: any) {
      // Erros de rede/servidor abrem o circuit breaker
      // Erros de validação (4xx exceto 429) não contam
      const status = error.response?.status;
      if (!status || status >= 500 || status === 429) {
        this.circuitBreaker.recordFailure();
      }

      const errData = error.response?.data?.error;
      logger.error(`Erro ao enviar template para ${to}`, {
        code: errData?.code,
        message: errData?.message,
        details: errData?.error_data,
      });
      throw error;
    }
  }

  /**
   * Enviar mensagem de texto livre (apenas dentro da janela de 24h)
   */
  async sendText(payload: SendTextPayload): Promise<MessageResponse> {
    this.ensureCircuitClosed();
    const { to, body: text, previewUrl = false } = payload;

    const body = {
      messaging_product: "whatsapp",
      to: this.formatPhone(to),
      type: "text",
      text: { body: text, preview_url: previewUrl },
    };

    try {
      const response = await this.client.post<MessageResponse>(
        `/${config.PHONE_NUMBER_ID}/messages`,
        body
      );
      this.circuitBreaker.recordSuccess();
      logger.info(`Texto enviado para ${to}`, {
        wamid: response.data.messages?.[0]?.id,
      });
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (!status || status >= 500 || status === 429) {
        this.circuitBreaker.recordFailure();
      }

      const errData = error.response?.data?.error;
      logger.error(`Erro ao enviar texto para ${to}`, {
        code: errData?.code,
        message: errData?.message,
      });
      throw error;
    }
  }

  /**
   * Marcar mensagem como lida
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.client.post(`/${config.PHONE_NUMBER_ID}/messages`, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    });
  }

  /**
   * Consultar qualidade do número de telefone
   */
  async getPhoneQuality(): Promise<PhoneNumberQuality> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}`,
      { params: { fields: "quality_rating,display_phone_number,verified_name,throughput,platform_type,code_verification_status" } }
    );
    return response.data;
  }

  /**
   * Listar templates de mensagem
   */
  async listTemplates(): Promise<any[]> {
    const response = await this.client.get(
      `/${config.WABA_ID}/message_templates`,
      { params: { limit: 100 } }
    );
    return response.data.data;
  }

  /**
   * Criar template de mensagem
   */
  async createTemplate(template: {
    name: string;
    category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
    language: string;
    components: any[];
  }): Promise<any> {
    const response = await this.client.post(
      `/${config.WABA_ID}/message_templates`,
      template
    );
    logger.info(`Template criado: ${template.name}`, { id: response.data.id });
    return response.data;
  }

  /**
   * Upload de mídia para o WhatsApp (retorna media_id)
   */
  async uploadMedia(
    buffer: Buffer,
    mimeType: string,
    filename: string
  ): Promise<string> {
    this.ensureCircuitClosed();

    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append("file", buffer, { filename, contentType: mimeType });

    try {
      const response = await this.client.post(
        `/${config.PHONE_NUMBER_ID}/media`,
        form,
        { headers: form.getHeaders() }
      );
      this.circuitBreaker.recordSuccess();
      const mediaId = response.data.id;
      logger.info(`Mídia uploaded: ${mediaId}`, { mimeType, size: buffer.length });
      return mediaId;
    } catch (error: any) {
      const status = error.response?.status;
      if (!status || status >= 500 || status === 429) {
        this.circuitBreaker.recordFailure();
      }
      const errData = error.response?.data?.error;
      logger.error("Erro ao fazer upload de mídia", {
        code: errData?.code,
        message: errData?.message,
      });
      throw error;
    }
  }

  /**
   * Enviar mensagem de áudio (dentro da janela de 24h)
   */
  async sendAudio(to: string, mediaId: string): Promise<MessageResponse> {
    this.ensureCircuitClosed();

    const body = {
      messaging_product: "whatsapp",
      to: this.formatPhone(to),
      type: "audio",
      audio: { id: mediaId },
    };

    try {
      const response = await this.client.post<MessageResponse>(
        `/${config.PHONE_NUMBER_ID}/messages`,
        body
      );
      this.circuitBreaker.recordSuccess();
      logger.info(`Áudio enviado para ${to}`, {
        wamid: response.data.messages?.[0]?.id,
        mediaId,
      });
      return response.data;
    } catch (error: any) {
      const status = error.response?.status;
      if (!status || status >= 500 || status === 429) {
        this.circuitBreaker.recordFailure();
      }
      const errData = error.response?.data?.error;
      logger.error(`Erro ao enviar áudio para ${to}`, {
        code: errData?.code,
        message: errData?.message,
      });
      throw error;
    }
  }

  // ========================
  // Conversational Automation
  // ========================
  async getConversationalAutomation(): Promise<any> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}/conversational_automation`
    );
    return response.data;
  }

  async setConversationalAutomation(payload: {
    enable_welcome_message?: boolean;
    prompts?: string[];
    commands?: Array<{ command_name: string; command_description: string }>;
  }): Promise<any> {
    const response = await this.client.post(
      `/${config.PHONE_NUMBER_ID}/conversational_automation`,
      payload
    );
    logger.info("Conversational automation atualizada", payload);
    return response.data;
  }

  // ========================
  // Business Profile
  // ========================
  async getBusinessProfile(): Promise<any> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}/whatsapp_business_profile`,
      { params: { fields: "about,address,description,email,profile_picture_url,websites,vertical" } }
    );
    return response.data?.data?.[0] || response.data;
  }

  async updateBusinessProfile(payload: {
    about?: string;
    address?: string;
    description?: string;
    email?: string;
    websites?: string[];
    vertical?: string;
  }): Promise<any> {
    const response = await this.client.post(
      `/${config.PHONE_NUMBER_ID}/whatsapp_business_profile`,
      { messaging_product: "whatsapp", ...payload }
    );
    logger.info("Perfil comercial atualizado", payload);
    return response.data;
  }

  // ========================
  // Block Users
  // ========================
  async getBlockedUsers(): Promise<any> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}/block_users`
    );
    return response.data;
  }

  async blockUser(phone: string): Promise<any> {
    const response = await this.client.post(
      `/${config.PHONE_NUMBER_ID}/block_users`,
      { messaging_product: "whatsapp", block_users: [{ user: this.formatPhone(phone) }] }
    );
    logger.info(`Usuário bloqueado: ${phone}`);
    return response.data;
  }

  async unblockUser(phone: string): Promise<any> {
    const response = await this.client.delete(
      `/${config.PHONE_NUMBER_ID}/block_users`,
      { data: { messaging_product: "whatsapp", block_users: [{ user: this.formatPhone(phone) }] } }
    );
    logger.info(`Usuário desbloqueado: ${phone}`);
    return response.data;
  }

  // ========================
  // QR Codes
  // ========================
  async listQRCodes(): Promise<any> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}/message_qrdls`
    );
    return response.data?.data || response.data;
  }

  async createQRCode(prefilled_message: string, generate_qr_image?: "PNG" | "SVG"): Promise<any> {
    const body: Record<string, any> = { prefilled_message, messaging_product: "whatsapp" };
    if (generate_qr_image) body.generate_qr_image = generate_qr_image;
    const response = await this.client.post(
      `/${config.PHONE_NUMBER_ID}/message_qrdls`,
      body
    );
    logger.info("QR Code criado", { prefilled_message });
    return response.data;
  }

  async deleteQRCode(code: string): Promise<any> {
    const response = await this.client.delete(
      `/${config.PHONE_NUMBER_ID}/message_qrdls`,
      { params: { code } }
    );
    logger.info(`QR Code removido: ${code}`);
    return response.data;
  }

  // ========================
  // Message History
  // ========================
  async getMessageHistory(params?: {
    message_id?: string;
    limit?: number;
    after?: string;
    before?: string;
  }): Promise<any> {
    const response = await this.client.get(
      `/${config.PHONE_NUMBER_ID}/message_history`,
      { params: { ...params } }
    );
    return response.data;
  }

  /**
   * Formatar telefone para padrão internacional (sem +, sem espaços)
   */
  private formatPhone(phone: string): string {
    let cleaned = phone.replace(/\D/g, "");
    // Se começa com 0, remove
    if (cleaned.startsWith("0")) cleaned = cleaned.slice(1);
    // Se não começa com 55 (Brasil), adiciona
    if (!cleaned.startsWith("55")) cleaned = `55${cleaned}`;
    return cleaned;
  }
}

export const whatsappApi = new WhatsAppAPI();
