import { listTemplates, getCatalogOptions } from "../src/lib/products/catalog";

(async () => {
  const opts = await getCatalogOptions();
  console.log("categorias:", opts.categories.length, "| web:", opts.publicCategories.length,
              "| impuestos:", opts.purchaseTaxes.length, "| proveedores:", opts.suppliers.length);

  const primera = await listTemplates({}, 1);
  console.log("total:", primera.total, "| filas:", primera.rows.length);
  console.log(primera.rows.slice(0, 3).map((r) => ({
    id: r.templateId, nombre: r.name, cat: r.categoryName,
    proveedor: r.supplierName, img: !!r.imageThumb, stock: r.qtyAvailable,
  })));

  const sinImagen = await listTemplates({ problem: "sin_imagen" }, 1);
  console.log("sin imagen:", sinImagen.total, "(esperado ~43)");

  const busqueda = await listTemplates({ query: "cuaderno" }, 1);
  console.log("busqueda 'cuaderno':", busqueda.total);
})();
