# Los Magos

Juego local y online por turnos con 48 cartas de magos para 2 a 5 jugadores.

## Reglas principales

- La partida usa 48 cartas físicas únicas.
- Una carta solo puede estar en una zona a la vez: mazo, descarte, HP, armadura, selección pendiente o emergencia.
- Los descartes pueden reutilizarse para recomponer HP, moviendo la carta al jugador y descartando las cartas reemplazadas.
- Un mago no puede atacarse a sí mismo.

## Comandos

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm dev:online
corepack pnpm worker:dev
corepack pnpm worker:deploy
corepack pnpm test
corepack pnpm build
```

## Online

El modo online usa salas privadas por WebSocket con servidor autoritativo. La lógica de sala vive en `server/online-room.mjs`, compartida por:

- `server/online-server.mjs`: servidor Node local para desarrollo rápido.
- `worker/los-magos-worker.mjs`: Cloudflare Worker + Durable Object para producción.

### Desarrollo local con Node

- Cliente: `corepack pnpm dev`
- Servidor autoritativo: `corepack pnpm dev:online`
- URL local: `http://localhost:5173/Los-Magos-card-game/`

El servidor escucha en `ws://localhost:8787` y mantiene las reglas de partida en el backend. Cada jugador recibe una vista filtrada: sus cartas pendientes y su carta secreta son privadas; los demás jugadores solo ven el estado público de la mesa.

### Desarrollo local con Cloudflare

Wrangler actual requiere Node.js 22 o superior.

```bash
corepack pnpm worker:dev
```

Wrangler expone el Worker localmente. Para que Vite use ese endpoint, configurá:

```bash
VITE_LOS_MAGOS_ONLINE_URL=ws://localhost:8787/ws corepack pnpm dev
```

### Deploy online

```bash
corepack pnpm dlx wrangler login
corepack pnpm worker:deploy
```

Después del deploy, configurá el frontend con la URL WebSocket del Worker:

```bash
VITE_LOS_MAGOS_ONLINE_URL=wss://los-magos-online.<tu-subdominio>.workers.dev/ws
```

Si el frontend se sirve desde el mismo dominio que el Worker, puede omitirse la variable y el cliente usará `/ws`.

### Deploy online con GitHub Actions

El workflow `Deploy Cloudflare Worker` se activa solo si esta variable del repo está en `true`:

```text
DEPLOY_CLOUDFLARE_WORKER=true
```

Secrets necesarios:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

Variable para que GitHub Pages apunte al Worker:

```text
VITE_LOS_MAGOS_ONLINE_URL=wss://los-magos-online.<tu-subdominio>.workers.dev/ws
```

### Checklist antes de publicar

- Dos navegadores crean y se unen a la misma sala.
- Solo el anfitrión puede iniciar.
- Cada jugador solo ve sus 3 cartas iniciales propias.
- Un jugador no puede elegir armadura ni accionar por otro mago.
- Los ataques, cambios de armadura, pases de turno y muertes se ven en todas las pantallas.
- La carta secreta de emergencia solo aparece para su dueño.
- Al desconectarse el anfitrión antes de empezar, el host pasa al siguiente jugador.

## Dirección visual

El mazo mantiene 48 cartas únicas. Las familias internas no se muestran como palos en la UI; solo se ve el número de la carta.

- Bastos: druidas de vara viva, ramas encantadas y magia de bosque.
- Espadas: arcanistas de acero, duelistas y guardia arcana.
- Copas: oráculos del cáliz, sanadores y reliquias espirituales.
- Oros: alquimistas del sol, monedas, contratos y transmutación.
