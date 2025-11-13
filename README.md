# El Impostor Web

Monorepo inicial para la PWA multijugador "El Impostor" (MERN + Socket.io + TypeScript).

Estructura:
- packages/shared: Tipos compartidos (TypeScript)
- packages/server: Backend (Express + Socket.io)
- packages/client: Frontend (React + Vite + Tailwind + socket.io-client)

Siguientes pasos después de clonar:

1. Instalar dependencias en la raíz (npm workspaces):

```bash
cd /Users/jobregon/Desktop/Impostor
npm install
```

2. Abrir dos terminales o usar el script `dev`:

```bash
npm run dev:server    # inicia servidor (ts-node-dev)
npm run dev:client    # inicia Vite
# o en una sola línea (zsh):
npm run dev
```

Notas:
- Este commit inicial crea un scaffold con tipos compartidos y handlers Socket.io básicos.
- Próximos pasos recomendados: ajustar autenticación ligera (displayName), persistencia en Redis para escalado, y UI de juego.
