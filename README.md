# Draw To Build – Global Build server v2

Zero-dependency Node.js (>= 18) server. **The old server did not know about ownership or the 24h rule – you must run this one
and point `config.js` at it**, otherwise the game shows a "Server lama" warning and falls back to the old (unprotected) behaviour.

## Run
    cd server
    PORT=8080 DATA_DIR=./data node server.js        # npm start
    npm test                                        # 16 end-to-end tests (fake clock)

| env | default | meaning |
|---|---|---|
| PORT | 8080 | listen port (cloud hosts usually set it for you) |
| DATA_DIR | ./data | where `world.json` lives – **must be on persistent storage** |
| TTL_HOURS | 24 | lifetime of a building (counted from `createdAt`) |
| SWEEP_SECONDS | 30 | how often the sweeper runs (it also runs at start-up, on join, on add and on /api/status) |
| SERVE_STATIC | – | set to `1` to also serve the game files (handy for local testing at http://localhost:8080) |

Put it behind HTTPS/WSS (itch.io is https, so the browser requires `wss://`). Then edit `config.js` in the game:

    SERVER_URL: 'wss://YOUR-HOST/ws',  STATUS_URL: 'https://YOUR-HOST/api/status'

## How the rules are enforced (all on the server)
* **Identity** – the browser keeps a private random key; the server derives `playerId = "u"+sha256("dtb-v2:"+key)[0..24]`.
  A `playerId`/`ownerId`/`pid` sent by a client is ignored. The key is never stored or broadcast.
* **Ownership** – `add` stamps `ownerId` + `createdAt` itself; `upd`, `del` and `delmany` check `ownerId` for **every** id
  (reply `delres {deleted, denied, missing}`); an object id can't be re-used to overwrite someone else's building.
* **24h auto-delete** – `now - createdAt >= 24h` → removed from memory *and* `world.json` (flushed immediately) and
  broadcast as `delmany {reason:'expired'}`. Based on the server clock and creation time, never on logins.
* **Old data** – buildings in an existing `world.json` without `createdAt` get their 24h timer at first load and no owner
  (`legacy`): nobody can edit/delete them, and they disappear after 24h.
