# SEO local para utilia.pro (Odoo 19)

Textos y codigo listos para pegar en el sitio. Orden recomendado: 1 → 7.
Datos del negocio tomados de la pagina de contacto y la ficha de Google Maps (oct 2026).

## 0. Decisiones previas (antes de pegar nada)

**NAP unico.** Telefono oficial: **+57 302 276 6090** (el de Google Maps). La web
(`/contactus` y pie de pagina) todavia muestra +57 311 608 2416: cambiarlo en Odoo →
Sitio web → Configuracion → Ajustes → datos de la empresa, y revisar Facebook,
Instagram, WhatsApp Business, Bing y Apple para que digan exactamente lo mismo.

**Nombre de la ficha de Google.** Hoy es "UTILia Papeleria, Impresiones y Servicios en
Sabaneta". Las directrices de Google piden el nombre real del negocio sin palabras clave
ni ciudad; las fichas asi pueden ser suspendidas tras una denuncia de un competidor.
Recomendacion: "Utilia Papeleria". Si prefieren mantenerlo, es una decision de riesgo
consciente, no un error tecnico.

**Dominio unico.** Odoo → Sitio web → Configuracion → Ajustes → Dominio:
`https://www.utilia.pro`. Hoy el canonical apunta a `utilia.pro` sin www.

---

## 1. Schema `Store` (datos estructurados del negocio)

Odoo 19 → Sitio web → Configuracion → Ajustes → seccion "Codigo personalizado" →
`<head>`. Pegar tal cual. Completar los `sameAs` con las URLs reales de Facebook e
Instagram y el telefono elegido.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Store",
  "@id": "https://www.utilia.pro/#tienda",
  "name": "Utilia Papeleria",
  "alternateName": "Utilia",
  "description": "Papeleria en Sabaneta, Antioquia: utiles escolares y de oficina, impresiones, fotocopias y escaner, pinateria, cacharreria, cosmeticos, cuidado personal, jugueteria, confiteria y detalles para regalo. Local 101 del centro comercial Mundo San Remo.",
  "url": "https://www.utilia.pro/",
  "logo": "https://www.utilia.pro/logo.png?company=1",
  "image": "https://www.utilia.pro/logo.png?company=1",
  "telephone": "+573022766090",
  "email": "hola@utilia.pro",
  "priceRange": "$",
  "currenciesAccepted": "COP",
  "paymentAccepted": "Efectivo, Tarjeta, Transferencia",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Calle 80 Sur #45-51, Local 101, Centro Comercial Mundo San Remo",
    "addressLocality": "Sabaneta",
    "addressRegion": "Antioquia",
    "postalCode": "055450",
    "addressCountry": "CO"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 6.1440746,
    "longitude": -75.6215133
  },
  "hasMap": "https://maps.app.goo.gl/rRuu84ZAEmndESA38",
  "openingHoursSpecification": [
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday"], "opens": "09:30", "closes": "20:30" },
    { "@type": "OpeningHoursSpecification", "dayOfWeek": ["Friday","Saturday"], "opens": "10:00", "closes": "19:00" },
    { "@type": "OpeningHoursSpecification", "dayOfWeek": "Sunday", "opens": "11:00", "closes": "15:00" }
  ],
  "areaServed": [
    { "@type": "City", "name": "Sabaneta" },
    { "@type": "City", "name": "Envigado" },
    { "@type": "City", "name": "La Estrella" },
    { "@type": "City", "name": "Itagui" }
  ],
  "sameAs": [
    "https://www.facebook.com/COMPLETAR",
    "https://www.instagram.com/COMPLETAR",
    "https://wa.me/573022766090",
    "https://maps.app.goo.gl/rRuu84ZAEmndESA38"
  ],
  "makesOffer": [
    { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Impresiones, fotocopias y escaner" } },
    { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Digitalizacion de documentos" } },
    { "@type": "Offer", "itemOffered": { "@type": "Service", "name": "Listas escolares completas" } }
  ]
}
</script>
```

Verificar despues en https://search.google.com/test/rich-results con la URL de la home.

---

## 2. Home

Editor de Odoo → bloque de texto arriba del todo. Dejar **un solo H1**; los demas
titulos de seccion pasan a H2.

**H1:** Papeleria, impresiones y pinateria en Sabaneta

**Texto (debajo del H1):**

> Utilia es una papeleria en Sabaneta, Antioquia, ubicada en el Local 101 del centro
> comercial Mundo San Remo (Calle 80 Sur #45-51). Tenemos utiles escolares y de oficina,
> cuadernos, servicio de impresiones, fotocopias y escaner, pinateria y decoracion para
> fiestas, cacharreria, cosmeticos, cuidado personal, jugueteria, confiteria y detalles
> para regalar.
>
> Atendemos de lunes a jueves de 9:30 a.m. a 8:30 p.m., viernes y sabados de 10:00 a.m.
> a 7:00 p.m. y domingos de 11:00 a.m. a 3:00 p.m. Puedes ver precios en nuestra tienda
> en linea, apartar por WhatsApp y recoger en el local.

**Meta titulo (ya esta bien, dejar):** Papeleria Sabaneta | Impresiones | Utiles Escolares | Utilia
**Meta descripcion (reemplazar, 152 car.):** Papeleria en Sabaneta: utiles escolares, impresiones, pinateria, cosmeticos y regalos. Mira precios en linea, aparta por WhatsApp y recoge en el local.

---

## 3. Tienda `/shop`

Editor → "Optimizar SEO" en la pagina de la tienda.

- **Meta titulo (54):** Tienda de papeleria en Sabaneta: precios en linea | Utilia
- **Meta descripcion (150):** Mas de 1.500 productos de papeleria, pinateria, cosmeticos y regalos con precio. Aparta por WhatsApp y recoge en Utilia, Sabaneta.
- **Titulo visible (H1):** Nuestra tienda: precios al dia, recoge en Sabaneta

---

## 4. Categorias (10)

Odoo → Sitio web → Comercio electronico → Categorias de productos → pestaña "Sitio web":
pegar la *Descripcion* (aparece arriba de los productos). Meta titulo y descripcion:
abrir la categoria en el sitio → "Optimizar SEO".

Todas cierran con la misma frase de accion porque no hay envios: *aparta por WhatsApp y
recoge en el local*. Cuando haya envios, cambiarla en las 10.

### Papeleria (`/shop/category/papeleria-4`)
- **Meta titulo (52):** Papeleria y utiles escolares en Sabaneta | Utilia
- **Meta descripcion (146):** Cuadernos, lapices, colores, carpetas y todo para el colegio y la oficina con precio en linea. Aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Todo lo que piden en la lista escolar y lo que necesita una oficina, en un solo lugar en
> Sabaneta: cuadernos cosidos y argollados, lapices, colores, marcadores, carpetas,
> papel, pegantes, tijeras y utiles para preescolar, primaria, bachillerato y
> universidad. Trabajamos con marcas conocidas y opciones economicas para que la lista
> completa salga al mejor precio. En temporada escolar armamos la lista por ti: nos la
> envias por WhatsApp y la tienes lista para recoger en el local. Precios actualizados
> cada dia desde nuestro inventario.

### Pinateria (`/shop/category/pinateria-8`)
- **Meta titulo (46):** Pinateria en Sabaneta: fiestas y globos | Utilia
- **Meta descripcion (149):** Pinatas, globos, velas, platos, decoracion y sorpresas para fiestas infantiles y celebraciones. Aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Decoracion y articulos para fiestas en Sabaneta: pinatas, globos de latex y metalizados,
> velas de cumpleanos, platos, vasos y servilletas tematicas, manteles, bolsas de
> sorpresa, letreros y todo para una fiesta infantil, un baby shower o una celebracion
> en casa. Tambien tenemos lo de temporada: Halloween, noche de velitas y Navidad.
> Cuentanos la fecha y el tema por WhatsApp y te armamos el combo para recoger en el
> local el mismo dia.

### Cacharreria (`/shop/category/cacharreria-3`)
- **Meta titulo (50):** Cacharreria y variedades en Sabaneta | Utilia
- **Meta descripcion (143):** Articulos para el hogar, organizadores, herramientas pequenas y variedades a buen precio. Aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> La seccion de variedades de Utilia: articulos para el hogar y la cocina, organizadores,
> ganchos, pilas, adhesivos, pequenas herramientas, bolsas de regalo, cintas y todo eso
> que uno necesita "ya" y no quiere ir hasta el centro a buscar. Inventario que cambia
> cada semana, asi que si buscas algo puntual preguntanos por WhatsApp y te confirmamos
> si lo tenemos para recoger en el local en Sabaneta.

### Cosmeticos (`/shop/category/cosmeticos-5`)
- **Meta titulo (45):** Cosmeticos y maquillaje en Sabaneta | Utilia
- **Meta descripcion (147):** Maquillaje, labiales, esmaltes, brochas y accesorios de belleza con precio en linea. Aparta por WhatsApp y recoge en Utilia, Sabaneta.
- **Descripcion:**
> Maquillaje y accesorios de belleza en Sabaneta a precios de papeleria de barrio:
> labiales, balsamos, esmaltes, sombras, delineadores, brochas, esponjas y pequenos
> detalles para regalar. Marcas accesibles para el dia a dia y novedades que llegan
> cada mes. Mira los precios en linea, aparta por WhatsApp y recoge en el local.

### Cuidado personal (`/shop/category/cuidado-personal-7`)
- **Meta titulo (48):** Cuidado personal y aseo en Sabaneta | Utilia
- **Meta descripcion (152):** Productos para el cabello, la piel y el aseo diario: cremas, shampoo, accesorios y mas. Precio en linea, aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Lo basico para cuidarte sin salir del barrio: cremas corporales, shampoo y tratamientos
> para el cabello, extensiones y accesorios, protectores, articulos de aseo personal y
> detalles de autocuidado para regalar. Tenemos presentaciones pequenas y familiares.
> Consulta precios en linea y aparta por WhatsApp para recoger en Utilia, Sabaneta.

### Jugueteria (`/shop/category/jugueteria-6`)
- **Meta titulo (44):** Jugueteria y regalos en Sabaneta | Utilia
- **Meta descripcion (150):** Juguetes, didacticos, munecos y detalles para ninos de todas las edades con precio en linea. Aparta por WhatsApp y recoge en Utilia, Sabaneta.
- **Descripcion:**
> Juguetes y detalles para ninos en Sabaneta: didacticos, carros, munecas, peluches,
> juegos de mesa, plastilinas, kits de arte y regalos para cumpleanos, dia del nino y
> Navidad. Opciones desde el detalle economico hasta el regalo especial. Si buscas algo
> para una edad o un gusto particular, escribenos por WhatsApp y te recomendamos; lo
> dejamos listo para recoger en el local.

### Confiteria (`/shop/category/confiteria-9`)
- **Meta titulo (47):** Dulces y confiteria para fiestas en Sabaneta | Utilia
- **Meta descripcion (144):** Dulces, chocolates, gomas y confites por unidad o para fiestas y sorpresas. Precio en linea, aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Dulces para la lonchera, para la fiesta y para la ancheta: gomas, chocolates,
> chupetas, confites y paquetes para rellenar pinatas y bolsas de sorpresa. Ideal para
> armar detalles junto con nuestra pinateria y papeleria. Consulta precios y aparta por
> WhatsApp para recoger en Utilia, Sabaneta.

### Tecnologia (`/shop/category/tecnologia-2`)
- **Meta titulo (52):** Accesorios de tecnologia en Sabaneta | Utilia
- **Meta descripcion (147):** Cables, cargadores, audifonos, memorias USB y accesorios para celular y computador. Precio en linea, aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Accesorios de tecnologia para el dia a dia en Sabaneta: cables y cargadores,
> audifonos, memorias USB, mouse, teclados, soportes para celular y pilas. Lo necesario
> para el colegio, la universidad y el trabajo, al lado de la papeleria y el servicio de
> impresiones. Precios en linea; aparta por WhatsApp y recoge en el local.

### Joyeria y accesorios (`/shop/category/joyeria-y-accesorios-12`)
- **Meta titulo (46):** Bisuteria y accesorios en Sabaneta | Utilia
- **Meta descripcion (146):** Aretes, collares, pulseras, moños y accesorios para el cabello, ideales para regalar. Precio en linea, aparta por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Bisuteria y accesorios en Sabaneta: aretes, collares, pulseras, anillos, moños,
> balacas y accesorios para el cabello, perfectos como detalle o para completar una
> ancheta. Novedades cada mes a precios de papeleria. Mira los precios en linea, aparta
> por WhatsApp y recoge en Utilia.

### Servicios (`/shop/category/servicios-10`)
- **Meta titulo (56):** Impresiones, fotocopias y escaner en Sabaneta | Utilia
- **Meta descripcion (151):** Impresion a color y blanco y negro, fotocopias, escaner y digitalizacion de documentos. Envia tu archivo por WhatsApp y recoge en Sabaneta.
- **Descripcion:**
> Servicio de impresiones, fotocopias y escaner en Sabaneta, en el Local 101 de Mundo San
> Remo. Imprimimos trabajos, guias, formatos y fotos a color o blanco y negro desde tu
> celular o correo: envia el archivo por WhatsApp y pasa a recogerlo. Tambien
> digitalizamos documentos y hacemos copias de cedula y papeles. Precios por hoja
> publicados en esta pagina.

---

## 5. Pagina de preguntas frecuentes `/faq`

Sitio web → Paginas → Nueva pagina "Preguntas frecuentes" (URL `/faq`). Pegar los
textos como titulo (H2) + parrafo y, en "Optimizar SEO", el meta. Agregar el enlace en
el menu y en el pie de pagina. Luego pegar el `FAQPage` en el `<head>` de esa pagina
(editor → Codigo personalizado de la pagina) o en el codigo global.

- **Meta titulo (49):** Preguntas frecuentes | Utilia Papeleria Sabaneta
- **Meta descripcion (139):** Horarios, ubicacion, impresiones por WhatsApp, listas escolares y medios de pago de Utilia, papeleria en Sabaneta, Antioquia.

**H1:** Preguntas frecuentes sobre Utilia

1. **¿Donde esta Utilia?**
   Utilia es una papeleria en Sabaneta, Antioquia, en la Calle 80 Sur #45-51, Local 101
   del centro comercial Mundo San Remo.
2. **¿Cual es el horario de atencion?**
   Lunes a jueves de 9:30 a.m. a 8:30 p.m., viernes y sabados de 10:00 a.m. a 7:00 p.m.
   y domingos de 11:00 a.m. a 3:00 p.m.
3. **¿Hacen envios a domicilio?**
   Por ahora no. Puedes apartar por WhatsApp y recoger en el local en Sabaneta.
4. **¿Puedo pedir por WhatsApp?**
   Si. Escribenos al +57 302 276 6090 con lo que necesitas; te confirmamos
   disponibilidad y precio y lo dejamos listo para recoger.
5. **¿Imprimen archivos enviados por WhatsApp o correo?**
   Si. Envia el PDF, Word o foto por WhatsApp o a hola@utilia.pro, indica color o blanco
   y negro y cantidad, y pasa a recogerlo.
6. **¿Hacen listas escolares completas?**
   Si. Envianos la lista del colegio por WhatsApp y la armamos completa; te avisamos
   cuando este lista para recoger.
7. **¿Que medios de pago reciben?**
   Efectivo, tarjeta debito y credito y transferencia.
8. **¿Los precios de la pagina son los de la tienda?**
   Si. La tienda en linea se actualiza cada dia con el inventario y los precios del
   local.
9. **¿Que venden ademas de papeleria?**
   Pinateria y decoracion para fiestas, cacharreria y variedades, cosmeticos, cuidado
   personal, jugueteria, confiteria, accesorios de tecnologia y bisuteria.
10. **¿Tienen parqueadero?**
    El centro comercial Mundo San Remo cuenta con parqueadero. *(Confirmar y ajustar.)*

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    { "@type": "Question", "name": "¿Donde esta Utilia?", "acceptedAnswer": { "@type": "Answer", "text": "Utilia es una papeleria en Sabaneta, Antioquia, en la Calle 80 Sur #45-51, Local 101 del centro comercial Mundo San Remo." } },
    { "@type": "Question", "name": "¿Cual es el horario de atencion?", "acceptedAnswer": { "@type": "Answer", "text": "Lunes a jueves de 9:30 a.m. a 8:30 p.m., viernes y sabados de 10:00 a.m. a 7:00 p.m. y domingos de 11:00 a.m. a 3:00 p.m." } },
    { "@type": "Question", "name": "¿Hacen envios a domicilio?", "acceptedAnswer": { "@type": "Answer", "text": "Por ahora no. Puedes apartar por WhatsApp y recoger en el local en Sabaneta." } },
    { "@type": "Question", "name": "¿Puedo pedir por WhatsApp?", "acceptedAnswer": { "@type": "Answer", "text": "Si. Escribenos al +57 302 276 6090 con lo que necesitas; te confirmamos disponibilidad y precio y lo dejamos listo para recoger." } },
    { "@type": "Question", "name": "¿Imprimen archivos enviados por WhatsApp o correo?", "acceptedAnswer": { "@type": "Answer", "text": "Si. Envia el PDF, Word o foto por WhatsApp o a hola@utilia.pro, indica color o blanco y negro y cantidad, y pasa a recogerlo." } },
    { "@type": "Question", "name": "¿Hacen listas escolares completas?", "acceptedAnswer": { "@type": "Answer", "text": "Si. Envianos la lista del colegio por WhatsApp y la armamos completa; te avisamos cuando este lista para recoger." } },
    { "@type": "Question", "name": "¿Que medios de pago reciben?", "acceptedAnswer": { "@type": "Answer", "text": "Efectivo, tarjeta debito y credito y transferencia." } },
    { "@type": "Question", "name": "¿Los precios de la pagina son los de la tienda?", "acceptedAnswer": { "@type": "Answer", "text": "Si. La tienda en linea se actualiza cada dia con el inventario y los precios del local." } },
    { "@type": "Question", "name": "¿Que venden ademas de papeleria?", "acceptedAnswer": { "@type": "Answer", "text": "Pinateria y decoracion para fiestas, cacharreria y variedades, cosmeticos, cuidado personal, jugueteria, confiteria, accesorios de tecnologia y bisuteria." } }
  ]
}
</script>
```

---

## 6. Blog

- Borrar el post de prueba "Viaje" (`/blog/viaje-1`): Sitio web → Blog → Entradas.
- Primer articulo (octubre): *Donde imprimir y fotocopiar en Sabaneta: precios, horarios y
  como enviar tu archivo por WhatsApp*. Enlaza a `/shop/category/servicios-10` y a la FAQ.
- Calendario completo en la conversacion de marketing (2 por mes, intencion local).

---

## 7. Google Search Console y Bing

1. https://search.google.com/search-console → Agregar propiedad → tipo "Dominio"
   `utilia.pro` → verificar con el registro TXT en el DNS del dominio.
2. Enviar el sitemap `https://www.utilia.pro/sitemap.xml`.
3. Pedir indexacion manual de: home, `/shop`, las 10 categorias y `/faq`.
4. Repetir en https://www.bing.com/webmasters (importa desde Search Console en un clic).

---

## 8. Perfil de Empresa en Google: estado y tareas

Estado (oct 2026): verificado, 5.0 con 29 reseñas, 75 fotos, categoria "Papeleria",
ultima publicacion 30 abr 2026.

- [ ] Cambiar el telefono de la web al 302 276 6090 (ver seccion 0).
- [ ] Agregar categorias secundarias: Tienda de articulos para fiestas, Centro de copiado,
      Tienda de cosmeticos, Jugueteria.
- [ ] Activar boton de mensajes / enlace de WhatsApp.
- [ ] Publicacion semanal (reusar los estados de WhatsApp). Llevan 6 meses sin publicar.
- [ ] Cargar productos: las mismas 9 colecciones del catalogo de WhatsApp.
- [ ] Reseñas: meta 5 por semana. Link corto de reseña en el mensaje post-venta de
      WhatsApp; doble participacion en el sorteo semanal por reseña.
- [ ] Responder todas las reseñas en menos de 48 h (ya lo hacen; mantener).
- [ ] Replicar la ficha en Bing Places, Apple Business Connect y Waze con el mismo NAP.
