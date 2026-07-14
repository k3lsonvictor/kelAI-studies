import "dotenv/config";

const requiredEnvVars = {
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  PHONE_NUMBER_ID: process.env.PHONE_NUMBER_ID,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
} as const;

// Validar a existência de todas as variáveis obrigatórias
for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    throw new Error(`A variável de ambiente obrigatória "${key}" não está definida.`);
  }
}

export const env = {
  verifyToken: requiredEnvVars.VERIFY_TOKEN,
  whatsappToken: requiredEnvVars.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: requiredEnvVars.PHONE_NUMBER_ID,
  openaiApiKey: requiredEnvVars.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  port: Number(process.env.PORT) || 3333,
} as const;