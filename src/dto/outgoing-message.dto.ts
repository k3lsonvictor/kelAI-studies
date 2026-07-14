export interface OutgoingMessageDTO {
  to: string;
  type: "text" | "image" | "document" | "audio" | "video";
  body: string;
}
