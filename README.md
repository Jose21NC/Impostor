# El Impostor Web

Juego multijugador tipo "palabra secreta" con rol de impostor oculto. Monorepo TypeScript con cliente React (Vite + Tailwind), servidor Express + Socket.io y paquete compartido de tipos/eventos.

## Paquetes

- `packages/shared`: Tipos y contratos de eventos (única fuente de verdad de modelo de datos).
- `packages/server`: Lógica autoritativa del juego (estado en memoria, Socket.io).
- `packages/client`: SPA React con modo TEST local y soporte de audio/YouTube.

## Desarrollo local

1. Instalar dependencias (root):
```bash
npm install
```
2. Servidores de desarrollo (se ejecutan en paralelo):
```bash
npm run dev
```
Equivalente a:
```bash
npm run dev:server & npm run dev:client
```

## Scripts
| Script | Descripción |
| ------ | ----------- |
| `npm run dev` | Levanta servidor y cliente juntos |
| `npm run build` | Compila shared, server y client (TS y bundle Vite) |
| `npm run dev:server` | Solo backend con ts-node-dev |
| `npm run dev:client` | Solo frontend Vite |

## Modo TEST
Unirse a sala con código `TEST` genera la partida local sin servidor: asigna roles y palabras usando `wordPairs` y simula impostor oculto si está habilitado.

## Configuración de sonido
El cliente soporta:
- URLs directas (`VITE_SOUND_*`) para reproducir efectos.
- IDs de YouTube (`VITE_YT_*`) para ambient y efectos cortos, inicializados vía IFrame API.

## Impostor oculto
Si `hiddenImpostor` está activo, el impostor recibe una palabra alternativa y se le muestra como civil (emoji y rol) dificultando pistas directas.

## Despliegue en Netlify (Frontend)
Netlify servirá solo el cliente estático. El servidor Socket.io debe alojarse externamente (Render, Fly.io, Railway, VPS con PM2, etc.) porque Netlify no mantiene conexiones WebSocket persistentes para un backend tradicional.

### Pasos
1. Crear la app en Netlify y apuntar al repositorio GitHub.
2. Asegurar que se use la rama deseada (`feat/refine-words-dark-ambient` o `main`).
3. Archivo `netlify.toml` ya incluido con:
	- `command = "npm run build"`
	- `publish = "packages/client/dist"`
4. En la UI de Netlify definir variables de entorno (copiar desde `.env.example`):
	- `VITE_SERVER_URL` => URL pública del backend (por ej. https://server-ejemplo.fly.dev)
	- Opcionales: `VITE_YT_AMBIENT_VIDEO_ID`, `VITE_SOUND_AMBIENT_URL`, etc.
5. Deploy: Netlify ejecutará build y expondrá la SPA con redirect `/* -> /index.html`.

### Backend externo
Para el servidor (socket.io con websockets reales):
1. Clonar repo en hosting externo.
2. Instalar dependencias y construir:
```bash
npm install
npm --workspace=@impostor/shared run build
npm --workspace=@impostor/server run build
```
3. Ejecutar servidor (ejemplo PM2):
```bash
pm2 start packages/server/dist/index.js --name impostor-server
```
4. Verificar CORS: permitir origen de la URL Netlify (`https://tu-netlify-app.netlify.app`).

### Consideraciones WebSocket
Netlify Functions no son apropiadas para Socket.io de larga duración; usar un servicio que soporte conexiones persistentes.

## Variables de entorno principales
| Variable | Uso |
| -------- | --- |
| `VITE_SERVER_URL` | Endpoint del servidor Socket.io |
| `VITE_YT_AMBIENT_VIDEO_ID` | Música ambiente YouTube opcional |
| `VITE_SOUND_AMBIENT_URL` | Audio ambiente directo |
| `VITE_YT_DRUM_ID` / `VITE_SOUND_DRUM_URL` | Sonido cuenta regresiva |
| `VITE_YT_APPLAUSE_ID` / `VITE_SOUND_APPLAUSE_URL` | Aplausos resultado |
| `VITE_YT_ROLE_REVEAL_CIVIL_ID` / `VITE_SOUND_ROLE_REVEAL_CIVIL_URL` | Reveal civil |
| `VITE_YT_ROLE_REVEAL_IMPOSTOR_ID` / `VITE_SOUND_ROLE_REVEAL_IMPOSTOR_URL` | Reveal impostor |

## Redirecciones SPA
`netlify.toml` incluye redirect `/* -> /index.html` para manejar rutas internas de React.

## Cache estática
Assets bajo `/assets/` usan `Cache-Control` largo (inmutable) para mejorar rendimiento.

## Extensiones futuras
- Persistencia del estado en Redis para múltiples instancias.
- Autenticación ligera (nickname reservado / reconexión).
- Panel de espectador y log de rondas.
- Tests automatizados de reparto de rol y sincronización de votos.

## Contribuir
1. Crear rama feature.
2. Commit descriptivo (convención `feat:` / `refactor:` / `fix:`).
3. Pull Request y revisión.

¡Diviértete descubriendo al impostor!
