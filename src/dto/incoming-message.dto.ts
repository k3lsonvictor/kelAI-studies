export interface IncomingMessageDTO {
  senderPhone: string;
  senderName: string;
  messageId: string;
  timestamp: Date;
  type: "text" | "image" | "document" | "audio" | "video" | "other";
  body: string;
  phoneNumberId: string;
  mediaId?: string | undefined;
  mediaUrl?: string | undefined;
  caption?: string | undefined;
  chatwootAccountId?: number | string | undefined;
  chatwootConversationId?: number | string | undefined;
}

/**
 * Helper para extrair e normalizar dados do webhook da Meta para o DTO da aplicação.
 */
export function parseIncomingMessage(payload: any): IncomingMessageDTO[] {
  const messagesList: IncomingMessageDTO[] = [];
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  
  if (!value || !value.messages) {
    return messagesList;
  }

  const phoneNumberId = value.metadata?.phone_number_id || "";

  for (const msg of value.messages) {
    const contact = value.contacts?.find((c: any) => c.wa_id === msg.from);
    const senderName = contact?.profile?.name || msg.from;
    const timestamp = new Date(Number(msg.timestamp) * 1000);

    let type: IncomingMessageDTO["type"] = "other";
    let body = "";
    let mediaId: string | undefined = undefined;
    let caption: string | undefined = undefined;

    if (msg.type === "text") {
      type = "text";
      body = msg.text?.body || "";
    } else if (msg.type === "image") {
      type = "image";
      mediaId = msg.image?.id;
      caption = msg.image?.caption;
      body = caption || "[Imagem]";
    } else if (msg.type === "document") {
      type = "document";
      mediaId = msg.document?.id;
      body = "[Documento]";
    } else if (msg.type === "audio") {
      type = "audio";
      mediaId = msg.audio?.id;
      body = "[Áudio]";
    } else if (msg.type === "video") {
      type = "video";
      mediaId = msg.video?.id;
      body = "[Vídeo]";
    }

    messagesList.push({
      senderPhone: msg.from,
      senderName,
      messageId: msg.id,
      timestamp,
      type,
      body,
      phoneNumberId,
      mediaId,
      caption,
    });
  }

  return messagesList;
}
