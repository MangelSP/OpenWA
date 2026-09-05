# OpenWA — Referencia de API para integración como módulo (NestJS + Next.js)

Documento generado desde el código fuente (controllers de `src/modules/`) el 2026-08-13.
Pensado para integrar OpenWA en un sistema externo NestJS + Next.js como **módulo activable por plan**.

## 1. Conceptos base

| Concepto | Valor |
|---|---|
| Base URL local | `http://localhost:2785/api` (prefijo global `api`) |
| Base URL producción | `https://<tu-servicio>.up.railway.app/api` |
| Autenticación | Header `X-API-Key: <key>` o `Authorization: Bearer <key>` |
| Roles de key | `admin` > `operator` > `viewer` |
| Scoping por key | `allowedSessions: string[]` — la key solo ve/opera esas sesiones (base del multi-tenant) |
| Swagger | `GET /api/docs` (en producción solo con `ENABLE_SWAGGER=true`) |
| Tiempo real | WebSocket Socket.IO, namespace `/events` |

**Regla de roles:** los endpoints marcados `admin`/`operator` exigen ese rol mínimo. Los que no tienen marca aceptan cualquier key válida (incluye `viewer`, solo lectura).

Una **sesión** = un número de WhatsApp vinculado (por QR o pairing code). Todo lo operativo cuelga de `/sessions/:sessionId/...`.

## 2. Endpoints

### 2.1 Salud (públicos, sin API key)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Estado general |
| GET | `/health/live` | Liveness probe |
| GET | `/health/ready` | Readiness probe (úsalo como healthcheck en Railway/K8s) |
| GET | `/infra/health` | Salud de infraestructura (también público) |

### 2.2 API Keys — `/auth` (rol: admin)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/api-keys` | Crear key (`name`, `role`, `allowedSessions?`, `expiresAt?`). La key en claro solo se devuelve aquí |
| GET | `/auth/api-keys` | Listar keys |
| GET | `/auth/api-keys/:id` | Detalle |
| PUT | `/auth/api-keys/:id` | Actualizar (rol, `allowedSessions`, habilitada…) |
| DELETE | `/auth/api-keys/:id` | Eliminar |
| POST | `/auth/api-keys/:id/revoke` | Revocar |
| POST | `/auth/validate` | Valida la key presentada en el header (cualquier rol) |

### 2.3 Sesiones — `/sessions`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/sessions` | operator | Crear sesión `{ name, config?, proxyUrl? }` (`config.autoRejectCalls`, `config.autoReconnect`…) |
| GET | `/sessions` | — | Listar (filtradas por `allowedSessions` de la key) |
| GET | `/sessions/:id` | — | Detalle/estado |
| DELETE | `/sessions/:id` | operator | Eliminar sesión |
| POST | `/sessions/:id/start` | operator | Iniciar (engine Baileys) |
| POST | `/sessions/:id/stop` | operator | Detener |
| POST | `/sessions/:id/logout` | operator | Cerrar sesión de WhatsApp (desvincular) |
| POST | `/sessions/:id/force-kill` | operator | Matar proceso colgado |
| GET | `/sessions/:id/qr` | operator | QR para vincular (imagen/base64) |
| POST | `/sessions/:id/pairing-code` | operator | Vinculación por código (sin QR) |
| GET | `/sessions/:id/chats` | — | Lista de chats |
| GET | `/sessions/:id/groups` | — | Lista de grupos |
| POST | `/sessions/:id/chats/read` | operator | Marcar chat leído |
| POST | `/sessions/:id/chats/unread` | operator | Marcar no leído |
| POST | `/sessions/:id/chats/delete` | operator | Borrar chat |
| POST | `/sessions/:id/chats/typing` | operator | Estado "escribiendo…" |
| GET | `/sessions/stats/overview` | — | Resumen de sesiones |

### 2.4 Mensajes — `/sessions/:sessionId/messages`

`to` usa WIDs: `628123456789@c.us` (individual), `<groupId>@g.us` (grupo). Texto máx. 4096 chars.

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | — | Listar mensajes de la sesión |
| POST | `/send-text` | operator | `{ to, text, mentions? }` |
| POST | `/send-template` | operator | Enviar plantilla |
| POST | `/send-image` | operator | Imagen (base64/URL) + `caption?` |
| POST | `/send-video` | operator | Video + `caption?` |
| POST | `/send-audio` | operator | Audio / nota de voz |
| POST | `/send-document` | operator | Documento + nombre de archivo |
| POST | `/send-location` | operator | Ubicación (lat/lng) |
| POST | `/send-contact` | operator | vCard |
| POST | `/send-sticker` | operator | Sticker |
| POST | `/send-poll` | operator | Encuesta |
| POST | `/reply` | operator | Responder citando un mensaje |
| POST | `/forward` | operator | Reenviar |
| POST | `/react` | operator | Reacción emoji |
| POST | `/edit` | operator | Editar mensaje enviado |
| POST | `/delete` | operator | Eliminar mensaje |
| GET | `/:chatId/history` | — | Historial de un chat |
| GET | `/:chatId/:messageId/reactions` | — | Reacciones de un mensaje |
| POST | `/send-bulk` | operator | Envío masivo (crea un batch) |
| GET | `/batch/:batchId` | — | Estado del batch |
| POST | `/batch/:batchId/cancel` | operator | Cancelar batch |

### 2.5 Contactos — `/sessions/:sessionId/contacts`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | — | Listar contactos |
| GET | `/profile-pictures` | — | Fotos de perfil en lote |
| GET | `/check/:number` | — | ¿El número tiene WhatsApp? |
| GET | `/:contactId` | — | Detalle |
| GET | `/:contactId/profile-picture` | — | Foto de perfil |
| GET | `/:contactId/phone` | — | Número desde el WID |
| POST | `/:contactId/block` | operator | Bloquear |
| DELETE | `/:contactId/block` | operator | Desbloquear |

### 2.6 Grupos — `/sessions/:sessionId/groups`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/` | operator | Crear grupo |
| GET | `/:groupId` | — | Detalle |
| POST | `/join` | operator | Unirse por código de invitación |
| GET | `/:groupId/settings` | — | Configuración |
| PUT | `/:groupId/settings` | operator | Cambiar configuración |
| POST | `/:groupId/participants` | operator | Agregar participantes |
| DELETE | `/:groupId/participants` | operator | Quitar participantes |
| POST | `/:groupId/participants/promote` | operator | Dar admin |
| POST | `/:groupId/participants/demote` | operator | Quitar admin |
| PUT | `/:groupId/subject` | operator | Cambiar nombre |
| PUT | `/:groupId/description` | operator | Cambiar descripción |
| POST | `/:groupId/leave` | operator | Salir del grupo |
| GET | `/:groupId/invite-code` | — | Código de invitación |
| POST | `/:groupId/invite-code/revoke` | operator | Revocar código |

### 2.7 Canales de WhatsApp — `/sessions/:sessionId/channels`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | — | Canales suscritos |
| GET | `/:channelId` | — | Detalle |
| GET | `/:channelId/messages` | — | Mensajes del canal |
| POST | `/subscribe` | operator | Suscribirse a un canal |
| DELETE | `/:channelId` | operator | Desuscribirse |

### 2.8 Estados/Historias — `/sessions/:sessionId/status`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| GET | `/` | — | Estados recibidos |
| GET | `/:contactId` | — | Estados de un contacto |
| GET | `/:statusId/media` | — | Media del estado |
| POST | `/send-text` | operator | Publicar estado de texto |
| POST | `/send-image` | operator | Publicar estado con imagen |
| POST | `/send-video` | operator | Publicar estado con video |
| DELETE | `/:statusId` | operator | Borrar estado propio |

### 2.9 Otros por sesión

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| PUT | `/sessions/:id/profile/name` | operator | Cambiar nombre de perfil |
| PUT | `/sessions/:id/profile/status` | operator | Cambiar "info" |
| PUT | `/sessions/:id/profile/picture` | operator | Cambiar foto |
| POST | `/sessions/:id/calls/:callId/reject` | operator | Rechazar llamada entrante |
| GET | `/sessions/:id/labels` | — | Etiquetas (WhatsApp Business) |
| GET | `/sessions/:id/labels/:labelId` | — | Detalle de etiqueta |
| GET | `/sessions/:id/labels/chat/:chatId` | — | Etiquetas de un chat |
| POST | `/sessions/:id/labels/chat/:chatId` | operator | Etiquetar chat |
| DELETE | `/sessions/:id/labels/chat/:chatId/:labelId` | operator | Quitar etiqueta |
| POST/GET/PUT/DELETE | `/sessions/:id/templates[...]` | operator | CRUD de plantillas propias |
| GET | `/sessions/:id/catalog` | — | Catálogo (WhatsApp Business) |
| GET | `/sessions/:id/catalog/products` | — | Productos |
| GET | `/sessions/:id/catalog/products/:productId` | — | Detalle de producto |
| POST | `/sessions/:id/messages/send-product` | operator | Enviar producto |
| POST | `/sessions/:id/messages/send-catalog` | operator | Enviar catálogo |
| GET | `/search` | operator | Búsqueda global de mensajes |

### 2.10 Webhooks (salientes) — `/sessions/:sessionId/webhooks`

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/` | operator | Crear webhook `{ url, events?, secret?, headers? }` (default events: `["message.received"]`) |
| GET | `/` | operator | Listar webhooks de la sesión |
| GET | `/:id` | operator | Detalle |
| PUT | `/:id` | operator | Actualizar |
| POST | `/:id/test` | operator | Enviar payload de prueba |
| DELETE | `/:id` | operator | Eliminar |
| GET | `/webhooks` (global) | operator | Todos los webhooks visibles para la key |
| GET | `/webhooks/delivery-failures` (global) | admin | Entregas fallidas |

**Eventos disponibles:**

```
message.received  message.sent      message.ack       message.edited
message.failed    message.reaction  message.revoked
session.qr        session.status    session.connected session.disconnected
session.authenticated  session.ready  session.reconnect_loop
group.join        group.leave       group.update
call.received     status.received   connection.update
```

**Headers que OpenWA envía a tu endpoint receptor:**

| Header | Contenido |
|---|---|
| `X-OpenWA-Event` | Nombre del evento |
| `X-OpenWA-Signature` | `sha256=<HMAC-SHA256 hex del body con tu secret>` (solo si configuraste `secret`) |
| `X-OpenWA-Idempotency-Key` | Deduplicación (guárdala y descarta repetidos) |
| `X-OpenWA-Delivery-Id` | ID de la entrega |
| `X-OpenWA-Retry-Count` | Número de reintento |

Responde `2xx` rápido (timeout ~10s) y procesa async; si no, OpenWA reintenta.

### 2.11 WebSocket tiempo real — namespace `/events`

- Conexión Socket.IO a `wss://<host>/events` con `auth: { apiKey: "<key>" }` en el handshake (nunca por query string).
- Frames: `{ action: "subscribe", ... }`, `{ action: "unsubscribe" }`, `{ action: "ping" }`.
- La key se revalida en cada subscribe y respeta `allowedSessions`; hay rate-limit por key/IP.

### 2.12 Administración de la plataforma (rol: admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/stats/overview` | Métricas globales |
| GET | `/stats/messages` | Métricas de mensajes |
| GET | `/stats/sessions/:sessionId` | Métricas por sesión (cualquier rol) |
| GET | `/audit` | Log de auditoría |
| GET / PUT | `/settings` | Configuración de la app |
| GET / PUT | `/infra/config` | Config de infraestructura |
| POST | `/infra/restart` | Reiniciar servicio |
| GET | `/infra/status` | Estado de infraestructura |
| GET | `/infra/engines` · `/infra/engines/current` | Engines disponibles/activo |
| GET | `/infra/storage/files/count` | Conteo de archivos de media |
| GET / POST | `/infra/storage/export` · `/infra/storage/import` | Backup/restore de media |
| GET / POST | `/infra/export-data` · `/infra/import-data` | Backup/restore de datos |
| GET | `/metrics` | Prometheus (público pero exige `Authorization: Bearer <METRICS_TOKEN>`; 404 si no está configurado) |
| — | `/api/admin/queues` | UI Bull Board de colas (key admin) |

### 2.13 Plugins e integraciones (rol: admin)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/plugins` · `/plugins/catalog` · `/plugins/:id` · `/plugins/:id/health` | Listado/catálogo/detalle/salud |
| POST | `/plugins/install` · `/plugins/install-url` | Instalar |
| POST | `/plugins/:id/enable` · `/plugins/:id/disable` · `/plugins/:id/update` | Ciclo de vida |
| PUT | `/plugins/:id/config` · `/plugins/:id/config/:sessionId` · `/plugins/:id/sessions` | Configuración |
| GET | `/plugins/:id/config-ui` | Esquema de UI de config |
| DELETE | `/plugins/:id` | Desinstalar |
| POST/GET/PATCH/DELETE | `/integration/plugins/:pluginId/instances[...]` | CRUD de instancias de integración (+ `POST :instanceId/regenerate-secret`) |
| POST | `/integration/instances/:pluginId/:instanceId/redrive` | Reprocesar entregas fallidas |
| ALL | `/ingress/:pluginId/:instanceId/*` | **Público** — entrada de webhooks de proveedores externos hacia plugins (autentica por secreto de instancia) |

## 3. Integración como módulo NestJS

### 3.1 Diseño recomendado

```
tu-api-nest/
└── src/modules/whatsapp/          # el "módulo OpenWA"
    ├── whatsapp.module.ts
    ├── openwa.client.ts           # wrapper HTTP (X-API-Key)
    ├── whatsapp.controller.ts     # endpoints hacia tu Next.js
    ├── openwa-webhook.controller.ts  # receptor de eventos de OpenWA
    └── plan.guard.ts              # gating por plan
```

Variables de entorno de tu API:

```
OPENWA_BASE_URL=https://<openwa>.up.railway.app/api
OPENWA_ADMIN_KEY=<key admin, solo para provisionar keys/sesiones>
OPENWA_WEBHOOK_SECRET=<secret HMAC que registras en cada webhook>
```

### 3.2 Cliente HTTP

```ts
// openwa.client.ts
@Injectable()
export class OpenwaClient {
  private base = process.env.OPENWA_BASE_URL!;

  private async request<T>(path: string, apiKey: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!res.ok) throw new HttpException(await res.text(), res.status);
    return res.json();
  }

  sendText(apiKey: string, sessionId: string, to: string, text: string) {
    return this.request(`/sessions/${sessionId}/messages/send-text`, apiKey, {
      method: 'POST',
      body: JSON.stringify({ to, text }),
    });
  }
  // ...un método por endpoint que uses
}
```

### 3.3 Multi-tenant + plan (el módulo como feature de un plan)

1. **Una API key `operator` por tenant**, creada al activar el módulo con la key admin:
   `POST /auth/api-keys { name: "tenant-<id>", role: "operator", allowedSessions: ["tenant-<id>-*"] }`.
   Guarda la key cifrada en tu BD junto al tenant. Así un tenant jamás puede tocar sesiones de otro.
2. **Gating por plan** con un guard en tus endpoints del módulo:

```ts
@Injectable()
export class WhatsappPlanGuard implements CanActivate {
  constructor(private subs: SubscriptionsService) {}
  async canActivate(ctx: ExecutionContext) {
    const { tenantId } = ctx.switchToHttp().getRequest();
    const plan = await this.subs.getActivePlan(tenantId);
    if (!plan?.features.includes('whatsapp')) {
      throw new ForbiddenException('Tu plan no incluye el módulo de WhatsApp');
    }
    return true;
  }
}
```

3. **Límites por plan** (nº de sesiones, mensajes/mes): tu API es el único punto de paso hacia OpenWA, así que cuenta ahí (tabla de consumo) antes de llamar al cliente.

### 3.4 Receptor de webhooks

```ts
// openwa-webhook.controller.ts
@Controller('webhooks/openwa')
export class OpenwaWebhookController {
  @Post()
  @HttpCode(200)
  handle(@Req() req: RawBodyRequest<Request>, @Headers() h: Record<string, string>) {
    const sig = createHmac('sha256', process.env.OPENWA_WEBHOOK_SECRET!)
      .update(req.rawBody!).digest('hex');
    if (h['x-openwa-signature'] !== `sha256=${sig}`) throw new UnauthorizedException();
    // dedup por h['x-openwa-idempotency-key'], luego encolar y responder ya
    return { ok: true };
  }
}
```

Registra el webhook al crear cada sesión:
`POST /sessions/:id/webhooks { url: "https://tu-api/webhooks/openwa", events: ["message.received","message.ack","session.status"], secret: OPENWA_WEBHOOK_SECRET }`.

### 3.5 Next.js

- El browser **nunca** ve keys de OpenWA: siempre pasa por tu API Nest (que aplica el guard de plan).
- QR de vinculación: tu endpoint Nest llama `GET /sessions/:id/qr` y lo devuelve; el front hace polling o escucha tu propio WS.
- Tiempo real en el front: re-emite los eventos del webhook (o del WS `/events`) por tu propio canal (Socket.IO/SSE de tu API). No conectes el browser directo al WS de OpenWA.

## 4. Flujo de activación resumido

```
Usuario contrata plan con módulo WhatsApp
  → tu API crea key operator (allowedSessions scoped al tenant)
  → crea sesión: POST /sessions { name: "tenant-123-main" }
  → registra webhook de la sesión (secret HMAC)
  → front muestra QR (GET /sessions/:id/qr) → usuario escanea
  → session.connected llega por webhook → módulo activo
  → enviar/recibir mensajes vía tu API (guard de plan + contadores)
```
