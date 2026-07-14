export interface WhatsAppProfile {
  name: string;
}

export interface WhatsAppContact {
  profile: WhatsAppProfile;
  wa_id: string;
}

export interface WhatsAppMessageText {
  body: string;
}

export interface WhatsAppMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'image' | 'document' | 'audio' | 'video' | 'interactive' | 'button' | 'unsupported';
  text?: WhatsAppMessageText;
  image?: {
    mime_type: string;
    sha256: string;
    id: string;
  };
  audio?: {
    mime_type: string;
    sha256: string;
    id: string;
    voice: boolean;
  };
  // Outros tipos de mídia ou interativos podem ser estendidos aqui
}

export interface WhatsAppStatusError {
  code: number;
  title: string;
  message?: string;
  error_data?: {
    details?: string;
  };
}

export interface WhatsAppStatus {
  id: string;
  status: 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id: string;
  errors?: WhatsAppStatusError[];
}

export interface WhatsAppMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

export interface WhatsAppChangeValue {
  messaging_product: 'whatsapp';
  metadata: WhatsAppMetadata;
  contacts?: WhatsAppContact[];
  messages?: WhatsAppMessage[];
  statuses?: WhatsAppStatus[];
}

export interface WhatsAppChange {
  value: WhatsAppChangeValue;
  field: 'messages';
}

export interface WhatsAppEntry {
  id: string;
  changes: WhatsAppChange[];
}

export interface WhatsAppWebhookPayload {
  object: 'whatsapp_business_account';
  entry: WhatsAppEntry[];
}

// Tipos para Envio de Mensagem (Response da Meta API)
export interface WhatsAppSendResponse {
  messaging_product: 'whatsapp';
  contacts: Array<{
    input: string;
    wa_id: string;
  }>;
  messages: Array<{
    id: string;
    message_status?: string;
  }>;
}
