import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { logger } from "./logger";

// ========================
// Text-to-Speech com vozes neurais Microsoft Edge (gratuito)
// ========================

const VOICES = {
  female: "pt-BR-ThalitaNeural",
  male: "pt-BR-AntonioNeural",
} as const;

type VoiceGender = keyof typeof VOICES;

interface TTSOptions {
  voice?: VoiceGender;
  /** Variação de velocidade, ex: "+10%", "-5%" */
  rate?: string;
  /** Variação de tom, ex: "+5Hz", "-3Hz" */
  pitch?: string;
  /** Variação de volume, ex: "+0%", "-10%" */
  volume?: string;
}

/**
 * Gera variações aleatórias de prosódia (velocidade, tom, volume)
 * para que cada áudio soe levemente diferente — como um humano real.
 */
function randomProsody(): { rate: string; pitch: string; volume: string } {
  // Velocidade: -8% a +12% (pessoas falam mais rápido quando animadas)
  const rate = Math.floor(Math.random() * 20) - 8;
  // Tom: -4Hz a +6Hz
  const pitch = Math.floor(Math.random() * 10) - 4;
  // Volume: -5% a +5%
  const volume = Math.floor(Math.random() * 10) - 5;

  return {
    rate: `${rate >= 0 ? "+" : ""}${rate}%`,
    pitch: `${pitch >= 0 ? "+" : ""}${pitch}Hz`,
    volume: `${volume >= 0 ? "+" : ""}${volume}%`,
  };
}

/**
 * Gera áudio MP3 a partir de texto usando Microsoft Edge TTS (neural, gratuito).
 * Retorna o Buffer do arquivo MP3.
 */
export async function textToAudio(text: string, options?: TTSOptions): Promise<Buffer> {
  const voiceGender: VoiceGender = options?.voice || (Math.random() > 0.5 ? "female" : "male");
  const voiceName = VOICES[voiceGender];
  const prosody = randomProsody();

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

  const { audioStream } = tts.toStream(text, {
    rate: options?.rate || prosody.rate,
    pitch: options?.pitch || prosody.pitch,
    volume: options?.volume || prosody.volume,
  });

  const buffer = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    audioStream.on("end", () => resolve(Buffer.concat(chunks)));
    audioStream.on("error", reject);
    // Timeout de segurança: 20s
    setTimeout(() => reject(new Error("TTS timeout após 20s")), 20_000);
  });

  if (buffer.length < 100) {
    throw new Error("Áudio gerado é muito pequeno, provável falha no TTS");
  }

  logger.info(`TTS gerado: ${buffer.length} bytes, voz: ${voiceName}`, {
    rate: prosody.rate,
    pitch: prosody.pitch,
    textLength: text.length,
  });

  return buffer;
}

/**
 * Gera variação do texto para soar mais natural em áudio.
 * Remove emojis e ajusta pontuação para melhor prosódia do TTS.
 */
export function prepareTextForTTS(text: string): string {
  return text
    // Remover emojis (TTS lê o nome unicode deles)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27FF}\u{FE00}-\u{FE0F}\u{200D}]/gu, "")
    // Limpar espaços extras
    .replace(/\s{2,}/g, " ")
    .trim();
}
