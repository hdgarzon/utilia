# Facturación electrónica DIAN — trámite

Lo que tiene que hacer la empresa **fuera de Odoo**. Este documento es para el representante
legal y el contador. La configuración técnica va en
[FACTURACION_ELECTRONICA_CO_ODOO.md](./FACTURACION_ELECTRONICA_CO_ODOO.md).

Ruta elegida: **servicio directo de la DIAN**, sin proveedor tecnológico. Es gratuito. A
cambio, la empresa compra y administra su propio certificado de firma digital.

> Los datos que salen de este trámite (Software ID, PIN, clave técnica, contraseña del
> certificado) son credenciales. Van al gestor de contraseñas de la empresa, nunca a un
> correo, un chat, ni un archivo del repositorio.

---

## Antes de empezar

Ten a la mano:

- Usuario y contraseña del representante legal en el portal de la DIAN (muisca).
- Certificado de existencia y representación legal, vigente.
- RUT de la empresa.
- Una cuenta de correo de la empresa a la que llegue todo el trámite.

**Tiempo total estimado: 2 a 4 semanas.** Casi todo es espera: la emisión del certificado
digital y los tiempos de respuesta de la DIAN.

---

## Paso 1 — Revisar el RUT

Verifica en el RUT que estén correctas:

- La **responsabilidad de IVA** que corresponda.
- La **actividad económica** (código CIIU).
- La dirección y el municipio.

Si algo está desactualizado, actualiza el RUT **antes** de seguir. El portal de habilitación
lee estos datos y no deja avanzar si no cuadran.

**Resultado:** RUT vigente y correcto.

---

## Paso 2 — Comprar el certificado de firma digital

Empieza por aquí. Es el paso con más tiempo de espera y todo lo demás depende de él.

Se compra a una entidad de certificación autorizada — Certicámara, Andes SCD, GSE,
Camerfirma u Olimpia, entre otras. Pide un certificado **de persona jurídica** a nombre de la
empresa, o de persona natural a nombre del representante legal.

Lo que recibes es un archivo con extensión `.p12` (a veces `.pfx`) **y una contraseña**.

> **La contraseña no se puede recuperar.** Si se pierde, hay que comprar el certificado otra
> vez. Guárdala en el gestor de contraseñas de la empresa en el momento en que la recibas.

Anota también la **fecha de vencimiento**. Un certificado vencido detiene la facturación por
completo, y la renovación no es inmediata.

**Resultado:** archivo `.p12` + contraseña + fecha de vencimiento.

---

## Paso 3 — Habilitarse como facturador electrónico

En el portal de la DIAN, dentro del **Sistema de Facturación Electrónica**, en el módulo de
habilitación.

Al registrarte te va a preguntar cómo vas a facturar. La respuesta es **software propio** —
no proveedor tecnológico. Odoo es el software de la empresa.

> Las etiquetas exactas del portal cambian de vez en cuando. Si algo no aparece con el nombre
> que dice aquí, busca la opción equivalente antes de asumir que falta.

**Resultado:** empresa registrada en el proceso de habilitación.

---

## Paso 4 — Registrar el software

Dentro del mismo módulo, registra el software con el que vas a facturar. De aquí salen los
tres datos más importantes del trámite:

| Dato | De dónde sale |
|---|---|
| **Software ID** | lo asigna la DIAN al registrar el software |
| **PIN del software** | lo defines tú — invéntalo y guárdalo |
| **Set de pruebas (TestSetId)** | lo genera el portal |

Los tres van al gestor de contraseñas y después al equipo técnico.

**Resultado:** Software ID, PIN y TestSetId.

---

## Paso 5 — Solicitar la resolución de numeración

Es un trámite aparte, en el mismo portal: la autorización para usar un rango de números de
factura.

Al solicitarla defines el **prefijo** (por ejemplo `FE`) y el **rango** (por ejemplo del 1 al
5000). La DIAN responde con:

| Dato | Para qué sirve |
|---|---|
| **Número de resolución** | identifica la autorización |
| **Fechas de vigencia** | desde cuándo y hasta cuándo puedes facturar con ella |
| **Prefijo y rango autorizados** | tienen que coincidir exactamente con lo que se configure en Odoo |
| **Clave técnica** | es la que genera el CUFE de cada factura |

> La **clave técnica** es un dato distinto del número de resolución. Es fácil confundirlos y
> es motivo de rechazo. Cópiala tal cual, sin espacios.

Pide también la resolución para el **documento soporte** de compras, si el contador confirma
que aplica.

**Resultado:** resolución con prefijo, rango, vigencia y clave técnica.

---

## Paso 6 — Entregar los datos al equipo técnico

Con esto se configura Odoo. Entrégalo por un canal seguro — el gestor de contraseñas
compartido, no por correo ni por chat.

- [ ] Archivo `.p12` y su contraseña
- [ ] Software ID
- [ ] PIN del software
- [ ] Set de pruebas (TestSetId)
- [ ] Número de resolución y fechas de vigencia
- [ ] Prefijo y rango autorizados
- [ ] Clave técnica

**Además, un dato que hay que preguntar:** cuál es el código de unidad de medida (UNECE) que
corresponde a "unidad". Todos los productos de la empresa se venden por unidad y ese código
tiene que ir en Odoo. Lo puede confirmar el contador.

---

## Paso 7 — Set de pruebas

El equipo técnico configura Odoo y emite contra el set de pruebas los documentos que exija la
DIAN: facturas, notas crédito y notas débito.

Aquí es normal que haya rechazos en las primeras vueltas. Cada rechazo trae un motivo, se
corrige el dato y se vuelve a emitir. Las causas más comunes son un prefijo que no coincide,
un cliente sin documento de identidad, o un producto sin clasificación.

**Tu papel en este paso:** completar los datos de los clientes que falten. Hoy hay **14
contactos sin número de documento** y esos no se pueden inventar.

**Resultado:** la DIAN aprueba el set de pruebas.

---

## Paso 8 — Habilitación y producción

Cuando la DIAN apruebe, la empresa queda habilitada. El equipo técnico apaga el modo de
pruebas en Odoo y se emite una primera factura real para confirmar que sale bien.

Desde ese momento la empresa factura electrónicamente.

**Resultado:** una factura real aceptada por la DIAN, con su CUFE.

---

## Después: dos cosas que no se pueden olvidar

**El certificado vence.** Ponle recordatorio dos meses antes de la fecha de vencimiento. La
renovación toma días y sin certificado no se factura.

**El rango de numeración se agota.** Cuando se acerque al final del rango autorizado hay que
pedir una resolución nueva. Si se agota, la facturación se detiene.

---

## Lo que este trámite NO cubre

**El tiquete POS.** Las ventas de mostrador siguen sin documento electrónico. La factura
electrónica que se habilita aquí sirve para los clientes que la pidan y para el documento
soporte de compras, pero el documento equivalente electrónico P.O.S. es un desarrollo aparte
que Odoo no trae de fábrica.

Es materia obligatoria bajo la Resolución 000165 de 2023. Conviene que el contador confirme
en qué situación queda la empresa mientras eso se resuelve, y ponerle fecha.
