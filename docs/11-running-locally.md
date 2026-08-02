# Levantar OpenWA en local

Dos formas: **Docker** (recomendada, igual a producción) o **manual en la terminal** (para desarrollar sobre el código con hot-reload).

---

## Opción A — Docker

### Requisitos
- Docker Desktop corriendo.
- Un `.env` en la raíz del repo (compose lo lee automáticamente). Mínimo relevante:

```env
# Solo se usa en el PRIMER arranque (cuando no existe ninguna key) para sembrar
# la key admin. Después de eso las keys viven en el volumen (data/main.sqlite)
# y cambiar esta variable NO cambia la key activa.
API_MASTER_KEY=<tu-key-maestra>

# Hosts permitidos para URLs de webhooks (validación anti-SSRF).
# Para que ankacrm local reciba webhooks desde el contenedor:
SSRF_ALLOWED_HOSTS=host.docker.internal
```

### Comandos

```bash
# Levantar (construye la imagen la primera vez)
docker compose up -d

# Reconstruir tras cambios de código y relanzar
docker compose build && docker compose up -d

# Ver logs
docker logs -f openwa-api

# Tumbar (los datos sobreviven: viven en volúmenes nombrados)
docker compose down
```

> ⚠️ **Nunca uses `docker compose down -v`**: borra los volúmenes `openwa-data`
> (API keys, sesiones de WhatsApp, sqlite) y `postgres-data` (mensajes). Con
> `down` a secas no se pierde nada.

### Verificar

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:2785/api/health
```

- API y dashboard: <http://localhost:2785> (puerto configurable con `API_PORT`, solo expuesto en 127.0.0.1).
- En el primer arranque el banner de logs muestra la key admin completa; después queda en `data/.api-key` (dentro del volumen) y en el dashboard.

---

## Opción B — Manual en la terminal (desarrollo)

### Requisitos
- Node 20+.
- No necesita Docker: por defecto usa SQLite (`data/main.sqlite` para auth/audit, `data/openwa.sqlite` para datos) y Baileys sin Chromium.

### Pasos

```bash
cd /Users/usuario/repos/OpenWA
npm install
```

Crea el `.env` si no existe (base mínima incluida en el repo):

```bash
cp .env.minimal .env
```

Para desarrollo local ajusta en `.env`:

```env
API_MASTER_KEY=<tu-key-maestra>   # siembra la key admin solo en el primer arranque
SSRF_ALLOWED_HOSTS=localhost      # webhooks hacia tu app local
```

Arrancar API + dashboard con hot-reload:

```bash
npm run dev
```

(`start:dev` solo API en watch; `start:prod` corre el build de `dist/`; `npm run build:all` compila API + dashboard.)

---

## Conectar con ankacrm (local)

1. En ankacrm: `/platform-admin` → **Configuración** → base URL `http://localhost:2785` + la key admin de OpenWA. (Queda en `private.app_settings`; el comando rápido por terminal es actualizar `openwa_api_key` ahí.)
2. En el `.env` de ankacrm: `APP_BASE_URL` debe ser alcanzable **desde OpenWA**:
   - OpenWA en Docker → `http://host.docker.internal:8080`
   - OpenWA manual → `http://localhost:8080`
3. `SSRF_ALLOWED_HOSTS` de OpenWA debe incluir ese host (`host.docker.internal` o `localhost`), si no, el registro de webhooks falla con "Destination address not allowed".

## Problemas típicos

| Síntoma | Causa / arreglo |
|---|---|
| `401 Invalid API key` desde ankacrm | La key en `private.app_settings` no coincide con una key viva de OpenWA. Copia la key real (`docker exec openwa-api printenv API_MASTER_KEY` si fue la sembrada) a la configuración de ankacrm. |
| `Destination address not allowed` al registrar webhook | Falta el host en `SSRF_ALLOWED_HOSTS` (reinicia OpenWA tras cambiarlo). |
| Cambié `API_MASTER_KEY` y no hace nada | Solo siembra en el primer arranque con cero keys. Rota/crea keys desde el dashboard o la API `/api/auth/api-keys`. |
