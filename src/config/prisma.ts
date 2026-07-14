import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { env } from "./env.js";

// Inicializa o Pool de Conexões do Postgres usando a biblioteca pg nativa
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || `postgresql://postgres:postgres@localhost:5433/kelia?schema=public`,
  max: 10, // número máximo de clientes no pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Inicializa o Driver Adapter do Prisma para PostgreSQL
const adapter = new PrismaPg(pool);

// Instancia o Prisma Client injetando o adapter (obrigatório no Prisma 7)
export const prisma = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
});
