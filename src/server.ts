import "dotenv/config";
import { app } from "./app.js";
import { env } from "./config/env.js";

async function bootstrap() {
  try {
    await app.listen({
      port: env.port,
      host: "0.0.0.0",
    });

    app.log.info(`Servidor iniciado e ouvindo na porta ${env.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

bootstrap();