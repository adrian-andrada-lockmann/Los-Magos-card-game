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
corepack pnpm test
corepack pnpm build
```

## Online

La primera escala online usa salas privadas con WebSocket:

- Cliente: `corepack pnpm dev`
- Servidor autoritativo: `corepack pnpm dev:online`
- URL local: `http://localhost:5173/Los-Magos-card-game/`

El servidor escucha en `ws://localhost:8787` y mantiene las reglas de partida en el backend. Cada jugador recibe una vista filtrada: sus cartas pendientes y su carta secreta son privadas; los demás jugadores solo ven el estado público de la mesa.

## Dirección visual

El mazo mantiene 48 cartas únicas. Las familias internas no se muestran como palos en la UI; solo se ve el número de la carta.

- Bastos: druidas de vara viva, ramas encantadas y magia de bosque.
- Espadas: arcanistas de acero, duelistas y guardia arcana.
- Copas: oráculos del cáliz, sanadores y reliquias espirituales.
- Oros: alquimistas del sol, monedas, contratos y transmutación.

Las imágenes viven en `public/cards` como WebP verticales `512x768`. La UI superpone número y escuela, así que el arte final no debe incluir letras, palabras ni números.
