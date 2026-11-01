# 🖍️ Draw To Build 🔨

A 3D browser sandbox: draw on a small canvas, press **Create / Build**, and your drawing becomes a chunky 3D object in front of you.
Play alone (**Singleplayer**, saves in your browser) or join the permanent shared world **Global Build** (**Global Multiplayer**).

Stack: HTML/CSS/JS, Three.js (r149), Node.js + WebSocket (`ws`). One process serves the frontend **and** the multiplayer server.

## Run locally
```bash
npm install
npm start          # http://localhost:3000
```
Open it in two browser windows → Global Multiplayer → **Global Build** to test multiplayer.

## Deploy (GitHub → Suga)
1. Push this folder to a GitHub repo (the repo root must contain `package.json` and `server.js`).
2. In Suga, create a **Node.js web service** from the repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - Port: the app listens on `process.env.PORT || 3000`.
   - WebSocket: the client connects to `ws(s)://<your-domain>/ws` on the same host, so no URL needs editing.
3. **Persistence (important):** the Global Build world is written to `DATA_DIR/world.json` (default `./data`).
   Many hosts have an ephemeral disk – attach a persistent volume in Suga and set `DATA_DIR` to its mount path
   (e.g. `DATA_DIR=/data`), otherwise the world resets whenever the container is rebuilt.
4. Health check path: `/health`. Status JSON: `/api/status`.
> I could not verify Suga-specific settings (I have no access to its docs); the app is a standard Node web service, so any host that runs `npm start` and supports WebSockets works. Check Suga's docs for the exact field names.

## Controls
| | PC | Phone (landscape) |
|---|---|---|
| Move | WASD | left joystick |
| Look | mouse (click to lock) | drag right side |
| Jump | Space | ⤒ |
| Interact / select | E or click | 🖐 or tap an object |
| Canvas | C | ✏️ |
| Inventory | Tab | 🎒 |
| Build / place held item | B | 🔨 |
| Camera 1st/3rd | V | 🎥 |
| Chat (multiplayer) | T | 💬 |
| Menu | Esc | ⏸ |
All keys can be rebound in Settings.

## How drawing becomes 3D
The canvas is sampled into a 40×40 colour grid; each filled cell becomes a column whose thickness grows toward the centre of the shape
(distance transform), so flat sketches become rounded 3D bodies. Faces hidden between cells are culled and the result is one mesh.
Complex drawings are simply approximated at 40×40. Use **Thickness** and **Size** in the canvas panel to tune it.
Collision uses the same grid, so doorways and gaps in your drawings are walkable, and you can climb on top of things.

## Multiplayer notes
- Everything (players, objects, edits, deletes, chat) is synced through `server.js`; new players receive the saved world.
- Anyone can move/resize/delete any object (it is a collaborative sandbox). Limit: 1200 objects.
- Player identity = random id kept in the browser's localStorage + chosen name/emoji.

## Project layout
`server.js` · `package.json` · `public/index.html` · `public/css/style.css` · `public/js/{builder,game}.js` · `data/` (world storage)
