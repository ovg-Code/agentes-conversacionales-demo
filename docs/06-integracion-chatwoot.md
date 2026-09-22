# 06 · Integración con Chatwoot

> Contrato extraído del **código fuente** de Chatwoot `v4.18.0` (clonado en `/home/user/chatwoot`, commit `e3b05e4`), no de la documentación pública. Varios de estos detalles no están documentados en la web y cambian el diseño.

---

## 1. El CRM y el chat son dos sistemas distintos

| | Chat (WhatsApp) | CRM (Chatwoot) |
|---|---|---|
| Qué es | El canal por donde habla el paciente | La bandeja donde el equipo humano trabaja |
| Quién lo ve | El paciente | Los agentes de Open Side |
| En este repo | `demo/` — simulador para pruebas | **Chatwoot real**, self-hosted |
| Quién lo construye | Nosotros | Ya existe: Rails 7.2 + Vue 3, MIT |

Nuestro agente **no es ninguno de los dos**: es un *Agent Bot* que se sienta entre ambos.

```
Paciente → WhatsApp Cloud API → Chatwoot (inbox)
                                    │ webhook agent_bot
                                    ▼
                            nuestro servidor (Claude + herramientas)
                                    │ Application API
                                    ▼
                                Chatwoot → WhatsApp → Paciente
```

---

## 2. Cómo firma Chatwoot los webhooks

`lib/webhooks/trigger.rb`:

```ruby
ts = Time.now.to_i.to_s
headers['X-Chatwoot-Timestamp'] = ts
headers['X-Chatwoot-Signature'] = "sha256=#{OpenSSL::HMAC.hexdigest('SHA256', @secret, "#{ts}.#{body}")}"
headers['X-Chatwoot-Delivery']  = delivery_id   # UUID
```

Tres cosas que importan y que la documentación no dice:

1. **Lo que se firma es `"{timestamp}.{body}"`, no el body solo.** Validar solo el body falla siempre.
2. El header trae el prefijo `sha256=`.
3. `X-Chatwoot-Delivery` es un UUID por entrega ⇒ **úsalo como clave de idempotencia**, porque hay reintentos.

La comparación debe ser en **tiempo constante** (`crypto.timingSafeEqual`), y conviene rechazar timestamps con más de ~5 minutos de desfase para evitar replay.

---

## 3. El hallazgo que cambia la arquitectura: 5 segundos

```ruby
def webhook_timeout
  timeout = GlobalConfig.get_value('WEBHOOK_TIMEOUT').presence&.to_i
  timeout&.positive? ? timeout : 5     # ← 5 segundos por defecto
end
```

**Chatwoot corta el webhook a los 5 segundos.** Un turno de Claude con dos o tres llamadas a herramientas puede tardar más. Por lo tanto:

> El endpoint del webhook **debe responder `200` de inmediato** y procesar el turno en segundo plano, publicando la respuesta después por la Application API.

Un endpoint que llame al modelo de forma síncrona y responda al final funcionará en pruebas y fallará en producción en cuanto el turno se complique. Es configurable (`WEBHOOK_TIMEOUT` en Super Admin), pero subirlo es tratar el síntoma: la respuesta asíncrona es la forma correcta.

---

## 4. Fail-safe de Chatwoot (aprovecharlo, no pelearlo)

Si el webhook falla en `message_created` o `message_updated` y la conversación está en `pending`:

```ruby
def update_conversation_status(message)
  conversation = message.conversation
  return unless conversation&.pending?
  return if conversation&.account&.keep_pending_on_bot_failure
  conversation.open!                        # ← escala a humano solo
  create_agent_bot_error_activity(conversation)
end
```

**Si nuestro bot se cae, la conversación pasa sola a la cola humana** y queda un mensaje de actividad en el hilo. Es exactamente la política que queremos: ningún paciente se queda sin respuesta porque el agente esté caído.

Se desactiva con `keep_pending_on_bot_failure` en los ajustes de la cuenta. **Para Open Side hay que dejarlo activado** (es decir, `keep_pending_on_bot_failure` en `false`).

Reintentos (`AgentBots::WebhookJob`): solo ante **HTTP 429 y 500**, 3 intentos, 3 segundos de espera. Un 4xx distinto de 429 no se reintenta — si devolvemos 400 por firma inválida, esa entrega se pierde y la conversación escala.

---

## 5. Eventos que recibe el bot

`app/listeners/agent_bot_listener.rb`:

| Evento | Cuándo |
|---|---|
| `message_created` | Mensaje nuevo (el principal) |
| `message_updated` | Mensaje editado o con estado cambiado |
| `conversation_opened` | La conversación pasa a `open` |
| `conversation_resolved` | Se resuelve |
| `conversation_status_changed` | Cambio de estado, con `changed_attributes` |
| `conversation_updated` | Cambio de atributos, con `changed_attributes` |
| `webwidget_triggered` | El widget web se abre |

El bot recibe eventos si está **activo en el inbox** (`agent_bot_inbox.active?`) o si es el `ai_assignee` de la conversación.

### Payload de `message_created`

`app/models/message.rb#webhook_data`:

```jsonc
{
  "event": "message_created",
  "id": 12345,
  "content": "Hola, quiero agendar una resonancia",
  "message_type": "incoming",        // incoming | outgoing | activity | template
  "content_type": "text",
  "content_attributes": {},
  "additional_attributes": {},
  "private": false,
  "source_id": "wamid...",           // id del mensaje en WhatsApp
  "created_at": "...",
  "sender":       { /* contacto */ },
  "conversation": { /* incluye id, status, custom_attributes, meta */ },
  "inbox":        { /* id, name */ },
  "account":      { /* id, name */ },
  "attachments":  [ /* solo si hay */ ]
}
```

**Filtrar siempre por `message_type === "incoming"` y `private === false`.** Nuestros propios mensajes vuelven como `outgoing` y procesarlos crearía un bucle.

---

## 6. Endpoints que usaremos (Application API)

Autenticación: header `api_access_token` con el token del **Agent Bot** (`AccessTokenable`).

| Acción | Endpoint |
|---|---|
| Responder | `POST /api/v1/accounts/{account}/conversations/{conv}/messages` |
| Nota privada | mismo endpoint con `"private": true` |
| Escalar a humano | `POST /api/v1/accounts/{account}/conversations/{conv}/toggle_status` → `{"status":"open"}` |
| Prioridad | `POST /api/v1/accounts/{account}/conversations/{conv}/toggle_priority` |
| Custom attributes | `PATCH …/conversations/{conv}` y `PUT …/contacts/{id}` |
| Labels | `POST …/conversations/{conv}/labels` |

El handoff del agente son tres llamadas en este orden: **nota privada con el contexto → labels → `toggle_status: open`**. Así el agente humano ya tiene el resumen cuando la conversación le aparece.

---

## 7. Levantar Chatwoot

El repo trae `docker-compose.yaml` (desarrollo) y `docker-compose.production.yaml`. Servicios: `rails`, `sidekiq`, `vite`, `postgres`, `redis`, `mailhog`.

```bash
cd chatwoot
cp .env.example .env          # ajustar SECRET_KEY_BASE, FRONTEND_URL
docker compose up -d postgres redis
docker compose run --rm rails bundle exec rails db:chatwoot_prepare
docker compose up -d
# http://localhost:3000
```

`SECRET_KEY_BASE` se genera con `rake secret`. Para MFA hacen falta además las tres claves de `ACTIVE_RECORD_ENCRYPTION_*` (`rails db:encryption:init`).

Después, en la UI: **Settings → Bots → Add Bot**, con la URL de nuestro webhook, y conectarlo al inbox de WhatsApp.

---

## 8. Consecuencias para nuestro código

Lo que hay que cambiar en `server/`:

1. **Endpoint `POST /webhooks/chatwoot`** que valida la firma `"{ts}.{body}"`, responde `200` en milisegundos y encola el turno.
2. **Cliente de la Application API** para publicar mensajes, notas privadas, labels y cambios de estado.
3. **Idempotencia por `X-Chatwoot-Delivery`**, porque hay reintentos.
4. **Filtro de `message_type`** para no responderse a sí mismo.
5. El estado de sesión pasa a estar **enlazado al `conversation.id` de Chatwoot**, no a un `sessionId` propio.
6. El panel "CRM · Chatwoot" del simulador queda como **maqueta de referencia**: el CRM real es Chatwoot.

---

## 9. Estado actual: Chatwoot levantado como referencia

Chatwoot **v4.18.0 corre en este entorno** con el compose de producción (imagen `chatwoot/chatwoot:latest`, `pgvector/pgvector:pg16`, `redis:alpine`):

```
$ curl -s localhost:3000/api
{"version":"4.18.0","queue_services":"ok","data_services":"ok"}
```

### Tropiezo a documentar

`docker-compose.production.yaml` trae `POSTGRES_PASSWORD=` **vacío y hardcodeado**, y eso gana sobre el `.env`. Postgres arranca en bucle con:

```
Error: Database is uninitialized and superuser password is not specified.
```

Hay que darle valor en el propio compose, no solo en `.env`.

### Qué miramos de Chatwoot

No vamos a desplegar Chatwoot como producto final: **haremos nuestra propia versión**. Lo que se toma de él es el diseño probado:

| De Chatwoot | Qué adoptamos |
|---|---|
| Ciclo `pending → open → resolved` | Tal cual: es exactamente el modelo bot ⇄ humano que necesitamos |
| Notas privadas en el hilo | Tal cual: es el vehículo del handoff |
| Custom attributes de contacto y conversación | Tal cual, con los campos clínicos de Open Side |
| Labels para enrutamiento y reportería | Tal cual |
| Bandeja de tres columnas | La estructura; el diseño visual es nuestro |
| Fail-safe: si el bot falla, la conversación pasa sola a `open` | **Imprescindible.** Ningún paciente se queda sin respuesta porque el agente esté caído |
| Firma HMAC sobre `"{ts}.{body}"` + id de entrega | El patrón de webhook firmado e idempotente |
| Timeout de 5 s en el webhook | La lección: **responder rápido y procesar en segundo plano** |

### Nuestro CRM

`demo/crm.html` es la primera versión propia: bandeja con filtros por estado y contadores, hilo con distinción visual entre paciente / agente virtual / persona, notas privadas, panel de custom attributes y acciones de tomar, devolver al bot y resolver.

Hoy se alimenta del bus local (`demo/src/bus.js`). El siguiente paso es sustituir ese bus por la API real —la de Chatwoot mientras lo usemos, o la nuestra cuando la tengamos—, sin tocar la interfaz: el CRM ya está escrito contra un modelo de datos, no contra un transporte.
