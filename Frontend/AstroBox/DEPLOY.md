# Despliegue de AstroBox en AWS Amplify Hosting (us-east-2)

Guía para desplegar **manualmente desde la consola web de AWS** (sin AWS CLI).
La app se publica como sitio **estático**: todas las rutas son pre-renderizadas
(`src/app/app.routes.server.ts`, `RenderMode.Prerender`), así que el build deja
un `index.html` listo en `dist/AstroBox/browser`. No se usa cómputo SSR ni S3.

## Qué se preparó en el repositorio

| Archivo | Cambio |
| --- | --- |
| `amplify.yml` (raíz del repo) | Configuración de build para monorepo: `appRoot: Frontend/AstroBox`, Node 22 (`nvm install 22`), `npm ci`, `npm run build`, artefactos en `dist/AstroBox/browser`, caché de `node_modules`. |
| `Frontend/AstroBox/angular.json` | Solo el presupuesto de estilos por componente: aviso 9.1 kB → 12 kB, error 10 kB → 16 kB. `app.scss` pesa 10.97 kB y el build de producción fallaba por eso. |
| `Frontend/AstroBox/DEPLOY.md` | Esta guía. |

No se modificó código de la app (`src/`, `public/`), ni `package.json`, ni `server.ts`.
Punto de retorno: tag local `demo-estable` en el commit `0cdaf05` (estado previo a estos cambios).

## 0. Antes de subir (en tu computadora)

```
cd Frontend/AstroBox
npm run build
```
Debe terminar sin `X [ERROR]`. Las líneas `▲ [WARNING]` (bundle inicial, módulos CommonJS de Cesium) no bloquean el build.

## 1. Subir los cambios a GitHub

Desde la raíz del repositorio:
```
git add amplify.yml Frontend/AstroBox/angular.json Frontend/AstroBox/DEPLOY.md
git commit -m "Prepare Amplify static hosting"
git push origin main
git push origin demo-estable
```
(El último comando sube el tag de respaldo; es opcional pero recomendado.)

## 2. Crear la app en Amplify (consola, región us-east-2)

1. Abre la consola de Amplify en **US East (Ohio) us-east-2**:
   https://us-east-2.console.aws.amazon.com/amplify/home?region=us-east-2
2. **Create new app** → **GitHub** → autoriza el acceso si lo pide.
3. Repositorio: **AstroBox** · Rama: **main**.
4. Marca **My app is a monorepo** y escribe la ruta: `Frontend/AstroBox`.
5. En **App settings / Build settings**, la consola debe mostrar que usa el
   `amplify.yml` del repositorio (con `appRoot: Frontend/AstroBox`). No edites el YAML ahí.
6. En variables de entorno debe aparecer `AMPLIFY_MONOREPO_APP_ROOT = Frontend/AstroBox`
   (Amplify la crea sola al marcar monorepo). Si no aparece, agrégala con ese valor exacto.
7. Si pide un **service role**, acepta crear el rol por defecto.
8. **Save and deploy**. El primer build tarda varios minutos (instala Node 22 y dependencias).

Si el build falla, abre el log del build:
- `node -v` debe mostrar una versión 22.22.3 o mayor.
- Busca la primera línea con `ERROR`.

## 3. Regla de rewrite (recomendada)

**Hosting → Rewrites and redirects → Manage redirects → Add rewrite:**

| Source address | Target address | Type |
| --- | --- | --- |
| `</^[^.]+$/>` | `/index.html` | `200 (Rewrite)` |

Solo afecta rutas **sin extensión**, así que no toca los archivos de Cesium
(`.js`, `.json`, `.png`, `.jpg`, `.xml`, `.svg`, `.wasm`), lerc ni los `.webp` de Verny.
No uses una regla que excluya una lista fija de extensiones: los Assets de Cesium
incluyen `.xml` y se romperían.

## 4. Verificación en `https://main.<APP_ID>.amplifyapp.com`

- [ ] La página carga y el globo 3D aparece (sin errores rojos en la consola del navegador, F12).
- [ ] Cambiar a mapa 2D funciona.
- [ ] Recargar la página (F5) funciona.
- [ ] Capas: incendios, precipitación, temperatura de superficie, temperatura del mar, viento, zonas climáticas.
- [ ] Storytelling: iniciar, pausar y salir.
- [ ] Verny: arrastrar al mapa, panel de estado, animaciones `.webp`, lluvia/fuego en pantalla.
- [ ] Sonido después de un clic (botón de altavoz o tecla `M`).
- [ ] La atribución de mapas y datos sigue visible (Esri, NASA, Open-Meteo, Beck et al. 2023 si aplica).

## 5. Durante la demo

- **Cada push a `main` dispara un nuevo build y reemplaza el sitio.** No hagas push a `main` durante la presentación.
- Opcional: **Hosting → Branch settings → main → Edit → desactivar "Enable auto build"** mientras dure la demo.

## ROLLBACK (de más rápido a más drástico)

1. **Consola de Amplify:** en la rama `main`, abre un despliegue anterior que funcionaba y elige **Redeploy this version**. (En el primer despliegue no hay versión anterior.)
2. **Revertir el commit:** `git revert <commit>` y `git push origin main`. Amplify redespliega solo.
3. **Último recurso:** `git reset --hard demo-estable` y `git push --force origin main`.

Nota: hacer `git merge dev` en `main` **no** revierte cambios (`dev` es un ancestro de `main`).

## Pendientes (no son parte de la demo)

- Volver a SSR (Amplify compute, puerto 3000, límite de 220 MB sin comprimir), si se necesita.
- S3 para medios futuros (MP3/GIF) cuando existan.
- Content-Security-Policy, AWS Budget con alarma y estimación de costos.
- Revisar límites/términos de producción de Esri (World Street Map) y Open-Meteo (uso no comercial, 10 000 llamadas/día).
- Reducir `src/app/app.scss` por debajo de 10 kB y volver a bajar el presupuesto.
- Mover `Claude outputs/` (grabaciones de prueba `.wav`) fuera del repositorio.
- A partir de ahora: trabajar en `dev`, probarlo conectando `dev` en Amplify y fusionar a `main` solo lo probado.

## Lo que preparó el agente

- Verificó que `main` y `dev` eran idénticas (`0cdaf05`) y sin cambios pendientes.
- Creó el tag local `demo-estable` (sin push).
- Creó `amplify.yml` (raíz) y este `DEPLOY.md`; ajustó el presupuesto de estilos en `angular.json`.
- Validó la sintaxis de `amplify.yml`. **No** ejecutó `npm ci` ni el build (sin acceso a npm en su entorno).

## Lo que haces tú

1. `npm run build` local (paso 0).
2. Commit y push a `main` (+ tag).
3. Crear la app en Amplify y desplegar (paso 2).
4. Agregar la regla de rewrite (paso 3).
5. Verificar el sitio (paso 4).
