export interface IncomingMessageDTO {
  senderPhone: string;
  senderName: string;
  messageId: string;
  timestamp: Date;
  type: "text" | "image" | "document" | "audio" | "video" | "other";
  body: string;
  phoneNumberId: string;
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

    if (msg.type === "text") {
      type = "text";
      body = msg.text?.body || "";
    } else if (msg.type === "image") {
      type = "image";
      body = "[Imagem]";
    } else if (msg.type === "document") {
      type = "document";
      body = "[Documento]";
    } else if (msg.type === "audio") {
      type = "audio";
      body = "[Áudio]";
    } else if (msg.type === "video") {
      type = "video";
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
    });
  }

  return messagesList;
}
