import "dotenv/config";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { followUpService } from "./services/follow-up.service.js";

async function bootstrap() {
  try {
    await app.listen({
      port: env.port,
      host: "0.0.0.0",
    });

    app.log.info(`Servidor iniciado e ouvindo na porta ${env.port}`);
    
    // Inicializa o serviço de follow-ups automáticos
    followUpService.start();

    // Tratamento de desligamento gracioso
    const stopGracefully = () => {
      app.log.info("Encerrando serviços de forma graciosa...");
      followUpService.stop();
      app.close(() => {
        app.log.info("Servidor Fastify finalizado.");
        process.exit(0);
      });
    };

    process.on("SIGINT", stopGracefully);
    process.on("SIGTERM", stopGracefully);

  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();