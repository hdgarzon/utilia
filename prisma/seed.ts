import { prisma } from "@/lib/prisma";

// Valor de ejemplo de .env.example: es publico, asi que no vale como clave real.
const EXAMPLE_PASSWORD = "cambia-esta-clave";

/**
 * El hash lo genera Postgres (pgcrypto), el mismo motor que lo valida en la
 * funcion `authenticate` al iniciar sesion. bcryptjs 3 solo produce el prefijo
 * `$2b$`, que el crypt() de pgcrypto no reconoce: un usuario sembrado asi no
 * podria entrar.
 */
async function hashPassword(plain: string): Promise<string> {
  const [{ hash }] = await prisma.$queryRaw<Array<{ hash: string }>>`
    SELECT crypt(${plain}, gen_salt('bf', 12)) AS hash
  `;
  return hash;
}

function adminCredentials() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim() || "admin@example.com";
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!password) {
    throw new Error(
      "Falta SEED_ADMIN_PASSWORD. Defínela en .env.local (ver .env.example) antes de correr pnpm db:seed.",
    );
  }
  if (password === EXAMPLE_PASSWORD) {
    throw new Error(
      "SEED_ADMIN_PASSWORD tiene el valor de ejemplo de .env.example. Usa una contraseña propia.",
    );
  }

  return { email, password };
}

async function main() {
  const admin = adminCredentials();
  const password = await hashPassword(admin.password);

  const user = await prisma.user.upsert({
    where: { email: admin.email },
    update: {},
    create: {
      name: "Administrador Utilia",
      email: admin.email,
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
  console.log("   Email:    " + user.email);
  console.log("   Password: la de SEED_ADMIN_PASSWORD (un usuario que ya existía conserva la suya)");
  console.log("\n   ⚠️  Cambia la contraseña después del primer inicio de sesión.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
