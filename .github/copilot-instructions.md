# Guía para Agentes de IA en "El Impostor"

Este documento proporciona una guía para trabajar en la base de código del juego "El Impostor".

## Arquitectura General

El proyecto es un monorepo de TypeScript que utiliza `npm workspaces`. Está estructurado en tres paquetes principales:

-   `packages/shared`: Contiene el código isomórfico, principalmente las definiciones de tipo de TypeScript y los contratos de eventos de Socket.io. **Este paquete es la única fuente de verdad para el modelo de datos y la comunicación**. Cualquier cambio en los eventos o en el estado del juego debe realizarse aquí primero.
-   `packages/server`: El backend de Node.js/Express. Utiliza `socket.io` para la comunicación en tiempo real y gestiona toda la lógica y el estado del juego. El estado se almacena en memoria, lo que lo hace adecuado para el desarrollo pero no persistente.
-   `packages/client`: Una aplicación de una sola página (SPA) de React construida con Vite. Se comunica con el servidor a través de `socket.io` y renderiza la interfaz de usuario del juego. El estilizado se realiza con Tailwind CSS.

### Flujo de Datos y Comunicación

-   La comunicación entre el cliente y el servidor se realiza exclusivamente a través de eventos de Socket.io.
-   Los tipos para los eventos y las cargas útiles están definidos en `packages/shared/src/types.ts` en las interfaces `ServerToClientEvents` y `ClientToServerEvents`.
-   El servidor (`packages/server/src/index.ts`) contiene toda la lógica autoritativa del juego. El cliente (`packages/client/src/App.tsx`) es principalmente una capa de presentación que envía las acciones del usuario al servidor.

## Flujo de Trabajo del Desarrollador

1.  **Instalación**: Ejecuta `npm install` en el directorio raíz para instalar todas las dependencias de los workspaces.
2.  **Desarrollo**: Ejecuta `npm run dev` en la raíz. Este comando inicia simultáneamente el servidor de desarrollo del cliente (Vite) y el servidor del backend (ts-node-dev).
3.  **Construcción**: Ejecuta `npm run build` para compilar los tres paquetes.

## Convenciones y Patrones

-   **Modo de Prueba del Cliente**: El cliente tiene un modo de prueba especial. Si te unes a una sala con el código `TEST`, la aplicación simulará una sala de juego localmente sin necesidad de un servidor. Esto es útil para desarrollar y probar componentes de la interfaz de usuario de forma aislada. La lógica para esto se encuentra en `packages/client/src/App.tsx`.
-   **Manejo del Estado**:
    -   En el servidor, el estado del juego se gestiona en dos mapas en memoria: `rooms` y `roomMeta`.
    -   En el cliente, el estado global del juego se gestiona con `useState` en el componente raíz `App.tsx`.
-   **Estilizado**: El cliente utiliza Tailwind CSS. Los estilos se aplican directamente en el JSX usando clases de utilidad.

## Archivos Clave

-   `packages/shared/src/types.ts`: Define la estructura de datos central y los eventos. Consulta este archivo antes de implementar nuevas características.
-   `packages/server/src/index.ts`: El punto de entrada del servidor y el núcleo de la lógica del juego.
-   `packages/client/src/App.tsx`: El componente principal de React que gestiona la mayor parte de la lógica del lado del cliente.
-   `package.json` (raíz): Contiene los scripts principales para ejecutar y construir el proyecto.
