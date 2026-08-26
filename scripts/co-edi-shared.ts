/**
 * Utilidades comunes de los scripts de facturación electrónica (CO).
 *
 * Todos los scripts `co-edi-*` son de solo lectura salvo que se pase `--apply`.
 */
import { odooRpc } from "@/lib/odoo";

export const { executeKw, searchRead } = odooRpc;

export interface Flags {
  /** Sin esto, ningún script escribe en Odoo. */
  apply: boolean;
  /** Salida detallada registro por registro. */
  verbose: boolean;
}

export function parseFlags(argv = process.argv.slice(2)): Flags {
  const desconocidas = argv.filter((a) => !["--apply", "--verbose", "--dry-run"].includes(a));
  if (desconocidas.length > 0) {
    console.error(`Opciones no reconocidas: ${desconocidas.join(", ")}`);
    console.error("Uso: [--apply] [--verbose]");
    process.exit(2);
  }
  return { apply: argv.includes("--apply"), verbose: argv.includes("--verbose") };
}

/** Odoo acepta listas largas de ids, pero un write gigante puede exceder el timeout. */
export function chunk<T>(items: T[], size = 200): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function titulo(texto: string): void {
  console.log(`\n${texto}\n${"─".repeat(texto.length)}`);
}

/** Contador de hallazgos: los bloqueantes determinan el exit code. */
export class Hallazgos {
  private bloqueantes = 0;
  private avisos = 0;

  ok(mensaje: string): void {
    console.log(`  ✓ ${mensaje}`);
  }

  aviso(mensaje: string): void {
    this.avisos += 1;
    console.log(`  ! ${mensaje}`);
  }

  bloqueante(mensaje: string): void {
    this.bloqueantes += 1;
    console.log(`  ✗ ${mensaje}`);
  }

  resumen(): number {
    titulo("Resumen");
    console.log(`  bloqueantes: ${this.bloqueantes}`);
    console.log(`  avisos:      ${this.avisos}`);
    if (this.bloqueantes === 0) console.log("\n  Sin bloqueantes. Se puede avanzar al siguiente paso del runbook.");
    return this.bloqueantes > 0 ? 1 : 0;
  }
}

/** Envuelve el main de cada script con manejo uniforme de errores. */
export function correr(main: () => Promise<number | void>): void {
  main()
    .then((code) => process.exit(typeof code === "number" ? code : 0))
    .catch((e: unknown) => {
      console.error("\nFATAL", e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
