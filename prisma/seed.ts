import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await hash("utilia2026!", 12);

  const user = await prisma.user.upsert({
    where: { email: "admin@utilia.co" },
    update: {},
    create: {
      name: "Administrador Utilia",
      email: "admin@utilia.co",
      password,
      role: "ADMIN",
    },
  });

  console.log("✓ Usuario creado:", user.email);

  await prisma.expenseBudget.createMany({
    skipDuplicates: true,
    data: [
      { category: "Arriendo", month: new Date().getMonth() + 1, year: new Date().getFullYear(), budgetAmount: 2500000 },
      { category: "Servicios", month: new Date().getMonth() + 1, year: new Date().getFullYear(), budgetAmount: 400000 },
      { category: "Nómina", month: new Date().getMonth() + 1, year: new Date().getFullYear(), budgetAmount: 3000000 },
      { category: "Publicidad", month: new Date().getMonth() + 1, year: new Date().getFullYear(), budgetAmount: 500000 },
      { category: "Otros", month: new Date().getMonth() + 1, year: new Date().getFullYear(), budgetAmount: 600000 },
    ],
  });

  console.log("✓ Presupuestos iniciales creados");
  console.log("\n🚀 Seed completado. Credenciales de acceso:");
  console.log("   Email:    admin@utilia.co");
  console.log("   Password: utilia2026!");
  console.log("\n   ⚠️  Cambia la contraseña después del primer inicio de sesión.");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
