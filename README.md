# CustomForge MX

Aplicación web con backend local para catálogo, cotizador 3D, termos personalizados, carrito y panel admin.

## Ejecutar

```powershell
& 'C:\Users\aaron\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' app.py
```

Abrir:

- Sitio público: http://127.0.0.1:4173/
- Admin: http://127.0.0.1:4173/admin

## Admin

Contraseña inicial:

```text
admin123
```

Cámbiala desde el panel admin en cuanto entres.

## Qué puedes editar

- Categorías.
- Productos STL/GLB con nombre, descripción, miniatura y precio base.
- Modelos de termo GLB, onzas, asa, precio base y precio por imagen/grabado.

## Archivos y datos

- Base de datos SQLite: `data/app.db`
- Uploads: `uploads/`
- Frontend público: `public/index.html`, `public/main.js`, `public/styles.css`
- Admin: `public/admin.html`, `public/admin.js`

## Notas

- El visualizador acepta STL y GLB.
- GLB conserva colores/materiales.
- Los modelos se cotizan intentando calcular volumen desde sus mallas.
- El lado mayor del modelo se limita entre 5 cm y 40 cm.
- El carrito arma el resumen completo para WhatsApp.
- La arquitectura ya separa API/datos/frontend para migrar después a una base de datos o almacenamiento externo más robusto.
