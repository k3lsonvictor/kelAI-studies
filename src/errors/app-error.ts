/**
 * Classe base para todos os erros conhecidos da aplicação.
 * Permite distinguir erros de negócio previstos de erros inesperados do servidor.
 */
export class AppError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Lançado quando a validação de algum dado falha.
 * Ex: Payloads de webhook ausentes ou campos obrigatórios incorretos.
 * HTTP correspondente: 400 Bad Request.
 */
export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

/**
 * Lançado quando um recurso solicitado não é encontrado no banco de dados.
 * Ex: Tentar fechar uma conversa que não existe ou buscar um contato inexistente.
 * HTTP correspondente: 404 Not Found.
 */
export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404);
  }
}

/**
 * Lançado quando ocorre uma falha na comunicação ou resposta da API do WhatsApp (Meta).
 * Ex: Token expirado, número de telefone incorreto ou cota excedida.
 * HTTP correspondente: 502 Bad Gateway.
 */
export class WhatsappApiError extends AppError {
  public readonly details?: any;

  constructor(message: string, details?: any) {
    super(message, 502);
    this.details = details;
  }
}
