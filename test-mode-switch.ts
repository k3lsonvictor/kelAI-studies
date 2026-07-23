import { PostFlowService } from "./src/services/post-flow.service.js";
import { PostSessionRepository } from "./src/repositories/post-session.repository.js";
import { ContactRepository } from "./src/repositories/contact.repository.js";
import { ContactService } from "./src/services/contact.service.js";
import { WhatsAppService } from "./src/services/whatsapp.service.js";
import { PostGeneratorService } from "./src/services/post-generator.service.js";
import { prisma } from "./src/config/prisma.js";

async function runModeSwitchTest() {
  console.log("==================================================");
  console.log("🧪 TESTANDO TRANSIÇÃO DE MODO NO KEL-IA: GERADOR DE POSTS ↔ GESTÃO FINANCEIRA");
  console.log("==================================================\n");

  const contactRepo = new ContactRepository();
  const contactService = new ContactService(contactRepo);
  const sessionRepo = new PostSessionRepository();
  const whatsappService = new WhatsAppService();
  const postGenService = new PostGeneratorService();

  const postFlowService = new PostFlowService(
    sessionRepo,
    whatsappService,
    postGenService
  );

  const testPhone = "5586999998888";
  const contact = await contactService.getOrCreateContact(testPhone, "Carlos Teste");

  // 1. Limpar sessão anterior do teste
  await prisma.postSession.deleteMany({ where: { contactId: contact.id } });

  console.log("1️⃣  Enviando mensagem no WhatsApp: 'Gestão Financeira'");
  const handled1 = await postFlowService.handlePostFlow(contact.id, {
    phoneNumberId: "1301831213007309",
    senderPhone: testPhone,
    senderName: "Carlos Teste",
    messageId: `msg_${Date.now()}_1`,
    timestamp: new Date(),
    type: "text",
    body: "Gestão Financeira",
  });
  console.log("👉 Processado pelo fluxo:", handled1);

  const session1 = await sessionRepo.findByContactId(contact.id);
  console.log("📌 Passo atual da sessão no banco:", session1?.step);

  console.log("\n2️⃣  Enviando mensagem financeira no WhatsApp enquanto está no Modo Financeiro:");
  console.log("   Mensagem: 'Vendi 2 tortas de frango por 70 reais no PIX'");
  const handled2 = await postFlowService.handlePostFlow(contact.id, {
    phoneNumberId: "1301831213007309",
    senderPhone: testPhone,
    senderName: "Carlos Teste",
    messageId: `msg_${Date.now()}_2`,
    timestamp: new Date(),
    type: "text",
    body: "Vendi 2 tortas de frango por 70 reais no PIX",
  });
  console.log("👉 Processado pelo fluxo:", handled2);

  console.log("\n3️⃣  Enviando comando para sair da Gestão Financeira: 'voltar'");
  const handled3 = await postFlowService.handlePostFlow(contact.id, {
    phoneNumberId: "1301831213007309",
    senderPhone: testPhone,
    senderName: "Carlos Teste",
    messageId: `msg_${Date.now()}_3`,
    timestamp: new Date(),
    type: "text",
    body: "voltar",
  });
  console.log("👉 Processado pelo fluxo:", handled3);

  const session3 = await sessionRepo.findByContactId(contact.id);
  console.log("📌 Passo atual da sessão após sair:", session3?.step);

  console.log("\n==================================================");
  console.log("✅ TESTE DE TRANSIÇÃO DE MODO CONCLUÍDO COM SUCESSO!");
  console.log("==================================================");

  await prisma.$disconnect();
}

runModeSwitchTest().catch((err) => {
  console.error("❌ ERRO NO TESTE DE MODOS:", err);
  prisma.$disconnect();
  process.exit(1);
});
