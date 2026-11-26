import { createDatabase } from "../src/shared/database/create-database.js";
import { hashPassword } from "../src/shared/security/password.js";

const database = createDatabase();

// One test user for each of the 8 people of the prototype. The ERP name of each
// seller is provisional until it is confirmed against the real ERP data.
const prototypeUsers = [
  { name: "Patrícia Lins", email: "patricia@distrilux.com.br", role: "SELLER" },
  {
    name: "Juliana Freitas",
    email: "juliana@distrilux.com.br",
    role: "SELLER",
  },
  { name: "Carla Menezes", email: "carla@distrilux.com.br", role: "SELLER" },
  {
    name: "Rodrigo Albuquerque",
    email: "rodrigo@distrilux.com.br",
    role: "SELLER",
  },
  { name: "Marcos Viana", email: "marcos@distrilux.com.br", role: "SELLER" },
  {
    name: "Fernanda Cavalcanti",
    email: "fernanda@distrilux.com.br",
    role: "MANAGER",
  },
  { name: "Sérgio Barros", email: "sergio@distrilux.com.br", role: "FINANCE" },
  { name: "Lucas Moura", email: "lucas@distrilux.com.br", role: "ADMIN" },
] as const;

function seedPassword(): string {
  const configured = process.env.SEED_USER_PASSWORD;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SEED_USER_PASSWORD is required to seed in production.");
  }
  return "distrilux-test-password";
}

try {
  // Add idempotent project seeds in this block.
  const passwordHash = await hashPassword(seedPassword());
  for (const user of prototypeUsers) {
    const erpSellerName = user.role === "SELLER" ? user.name : null;
    await database.user.upsert({
      where: { email: user.email },
      update: { name: user.name, role: user.role, erpSellerName },
      create: { ...user, passwordHash, erpSellerName },
    });
  }
  // <example-item-seed>
  await database.exampleItem.upsert({
    where: { id: "00000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Example item",
      description: "Safe to remove with pnpm remove:example",
    },
  });
  // </example-item-seed>
} finally {
  await database.$disconnect();
}
