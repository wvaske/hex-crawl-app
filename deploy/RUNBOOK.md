# HexCrawl VTT — Deployment runbook (alder01.vaske.us)

Turnkey steps to deploy the app as a Portainer stack on `alder01`, backed by a
new iSCSI volume from `blocks.vaske.us`, with a dedicated macvlan IP and a
public DNS entry at `hex-crawl.deeznuts.wiki`.

All commands assume root SSH to `alder01` (172.16.1.10) and follow the homelab
conventions already in use for the deeznuts-wiki stack.

> **Status: EXECUTED 2026-08-29.** Live at https://hex-crawl.deeznuts.wiki and
> http://hex-crawl.vaske.us:3000 (internal). Facts as deployed:
> - iSCSI: target `block.vaske.us:hexcrawl` (zvol `block/hexcrawl`, 10 GiB sparse),
>   XFS UUID `2bc8b607-9d5a-46c8-8f17-03f063adc57d`, node.startup=automatic
> - Docker volume `hexcrawl_data`; image `hex-crawl:latest` built on alder01
>   from `/root/hex-crawl-build`; compose project `hex-crawl` at
>   `/root/stacks/hex-crawl` (mirrored in docker-compose repo `stacks/hex-crawl`)
> - IP 172.16.2.40 (homenet); Traefik route `/dynamic/hex-crawl.yml`; public DNS
>   A `hex-crawl.deeznuts.wiki -> 71.211.246.196` (Cloudflare); LE cert issued
> - Campaign data seeded from dev `./data` (the deployed instance is authoritative now)

---

## 1. Build & publish the image

The repo Dockerfile produces a single self-contained image (bundled server +
built client). Two options:

**A. Build on alder01 (simplest — no registry):**
```bash
git clone <repo> hex-crawl && cd hex-crawl
git checkout main
docker build -t hex-crawl:latest .
```

**B. Build elsewhere and push to a registry alder01 can reach**, then set
`HEXCRAWL_IMAGE` in the stack env.

Verify: `docker run --rm -e DATA_DIR=/tmp -p 3000:3000 hex-crawl:latest` then
`curl localhost:3000/api/health` → `{"ok":true}`.

## 2. Create the iSCSI LUN on blocks.vaske.us (TrueNAS, 172.16.1.2)

In the TrueNAS UI (or `midclt`):
1. Create a zvol, e.g. `tank/hexcrawl`, size ~5 GB (SQLite + uploaded map art;
   the six Faerûn maps are ~40 MB each, so 5 GB is generous).
2. Add it as an extent to the iSCSI target used by alder01 (new LUN number on
   the existing target, or a dedicated target `...:hexcrawl`).
3. Note the target IQN and LUN.

## 3. Attach + format on alder01

```bash
# Discover & log in (portal is 172.16.1.2)
iscsiadm -m discovery -t sendtargets -p 172.16.1.2
iscsiadm -m node -T <iqn.for.hexcrawl> -p 172.16.1.2 --login

# Identify the new block device (e.g. /dev/sdX) and format XFS
lsblk
mkfs.xfs -L hexcrawl /dev/sdX
blkid /dev/sdX   # copy the UUID

# CRITICAL (per homelab iSCSI notes): mark the node record automatic so the
# boot-time iscsi-volume-guard logs it in before docker.service starts.
iscsiadm -m node -T <iqn.for.hexcrawl> -p 172.16.1.2 --op update \
  -n node.startup -v automatic
```

> Do **NOT** add an fstab entry. Docker's local volume driver mounts/unmounts
> the device itself; an fstab mount causes "device busy" and the container
> fails to start. The existing `iscsi-volume-guard` is host/portal-based and
> picks up the new automatic record with no changes.

## 4. Create the docker volume on the LUN

```bash
docker volume create --driver local \
  --opt type=xfs \
  --opt device=/dev/disk/by-uuid/<UUID-from-step-3> \
  hexcrawl_data
```

## 5. Pick and verify a free macvlan IP

The `homenet` macvlan hands out static `172.16.2.x` addresses. Known in use:
Traefik `172.16.2.28`, mw_db/app `172.16.2.29`. The stack defaults to
`172.16.2.40` — **verify it's actually unused first**:

```bash
# From alder01 (or any homenet host). Expect no reply.
ping -c2 172.16.2.40
arping -c2 -I <macvlan-parent> 172.16.2.40 2>/dev/null || true
# Also scan the low block to see current allocation:
for i in $(seq 20 60); do ping -c1 -W1 172.16.2.$i >/dev/null && echo "172.16.2.$i IN USE"; done
```
If `.40` responds, choose another free address and set `HEXCRAWL_IP` (stack
env) and the `url` in `traefik-hex-crawl.yml` to match.

## 6. Deploy the Portainer stack

Portainer server runs on `lp-01`; add the stack against the `alder01` endpoint.
- Stack name: `hex-crawl`
- Compose: `deploy/docker-compose.yml`
- Env vars:
  - `HEXCRAWL_IMAGE` = `hex-crawl:latest` (or your registry path)
  - `HEXCRAWL_IP` = the verified free address (default `172.16.2.40`)

Deploy, then confirm: `docker ps | grep hex-crawl` healthy, and
`curl http://172.16.2.40:3000/api/health`.

## 7. Public DNS + TLS at hex-crawl.deeznuts.wiki

Follow the split-horizon pattern from the wiki:
1. **Traefik route:** copy `deploy/traefik-hex-crawl.yml` to
   `/var/lib/docker/volumes/deeznuts_deeznuts/_data/traefik/dynamic/hex-crawl.yml`
   (edit the `url` if the IP changed). Traefik hot-reloads; if the ACME order
   doesn't issue, `docker restart traefik`.
2. **Public DNS:** add an A record `hex-crawl.deeznuts.wiki → 71.211.227.85`
   (the same public IP that fronts wiki.deeznuts.wiki → Traefik). Cloudflare
   DNS token is in `lab-admin/.env` (`CLOUDFLARE_API_TOKEN`).
3. **Internal DNS (optional):** if you want LAN clients to hit the app directly,
   add an internal record → `172.16.2.40`. Otherwise LAN clients go through
   Traefik too, which is fine.

Verify: `https://hex-crawl.deeznuts.wiki/` loads the landing page, and
`wss://hex-crawl.deeznuts.wiki/ws?...` upgrades (the app's WS runs on the same
origin/port, so the single router covers it).

## 8. Seed the campaign data

The dev database (this repo's `./data/`) holds the "Deez Nuts vs Tiamat"
campaign with all six Faerûn maps, ~880 location pins, terrain, and overlays.
To carry it onto the deployed volume:

```bash
# On the machine holding ./data (stop the container first for a clean copy):
tar czf hexcrawl-data.tgz -C data .
scp hexcrawl-data.tgz root@alder01:/tmp/

# On alder01, load into the volume (container stopped):
docker run --rm -v hexcrawl_data:/data -v /tmp:/backup alpine \
  sh -c "cd /data && tar xzf /backup/hexcrawl-data.tgz"
docker start hex-crawl
```

Or start fresh and let the DM create a new campaign — the schema self-migrates
on first boot.

## 9. Backups

Two layers, and you want both:

### 9a. Volume-level (everything, opaque)

The entire state is the `hexcrawl_data` volume (SQLite `hexcrawl.db` + WAL +
`uploads/`). Back up with the same tar-from-volume approach as step 8, or
snapshot the zvol on TrueNAS. This is the disaster-recovery copy: it restores
the whole instance, all campaigns, ids and invite keys intact.

> Copy the volume with the container **stopped** (or snapshot the zvol) — a live
> `hexcrawl.db` has a WAL alongside it, and a naive file copy can be torn.

### 9b. Per-campaign export (portable, restorable anywhere)

`GET /api/campaigns/<id>/export` returns one JSON document holding every row for
that campaign plus its uploaded images (base64-embedded). It is authorized by
the DM seat cookie **or** `?key=<dmKey>`, so cron and `curl` can pull it.

The archive contains **no secrets**: no DM/player invite keys, no seat auth
tokens (`"secrets": false` marks this). Restoring one therefore creates a *new*
campaign with new ids and new invite links — it is a copy, not an in-place
overwrite. Restore either way:

- **UI:** landing page → *Restore from backup* → pick the `hexcrawl-*.json`
  file. You land in the new campaign as its DM.
- **API:** `POST /api/campaigns/import` with the JSON as the request body
  (`Content-Type: application/json`) or as multipart field `file`. Max 100 MB.
  Responds `{campaignId, dmKey, playerKey}`.

```bash
# Manual pull
curl -fsS "https://hex-crawl.deeznuts.wiki/api/campaigns/<id>/export?key=<dmKey>" \
  -o hexcrawl-<id>-$(date -u +%F).json

# Manual restore (into any instance running this version)
curl -fsS -X POST "https://hex-crawl.deeznuts.wiki/api/campaigns/import" \
  -F "file=@hexcrawl-<id>-2026-08-30.json"
```

Because ids are remapped on import, an archive can be restored **into the same
instance it came from** — handy for "fork the campaign before the session" or
for recovering a single campaign without touching the others.

Known limits (v1, `formatVersion: 1`):
- Seats are not restored (they hold auth tokens). The importer gets a fresh DM
  seat; players re-join with the new player link and re-claim characters.
- Log entries whispered to a single seat come back DM-only — that seat is gone.
- Log `data` blobs keep their original ids (they drive toasts/detail text only).

### 9c. Cron the export: `deploy/backup.sh`

`deploy/backup.sh` pulls one campaign, writes a dated file, and prunes to the N
most recent. It fails loudly (non-zero, message on stderr) if the key is wrong,
the campaign is gone, or the response is not an export — so cron mail is
meaningful.

```bash
install -m 0755 deploy/backup.sh /usr/local/bin/hexcrawl-backup.sh
install -d -m 0700 /var/backups/hexcrawl
```

Environment (all read from the env, nothing hard-coded):

| Variable | Meaning |
| --- | --- |
| `HEXCRAWL_URL` | instance base URL, e.g. `https://hex-crawl.deeznuts.wiki` |
| `HEXCRAWL_CAMPAIGN` | campaign id |
| `HEXCRAWL_DM_KEY` | that campaign's DM key (from the DM's link, or `/api/campaigns/<id>/keys`) |
| `BACKUP_DIR` | output dir (default `/var/backups/hexcrawl`) |
| `KEEP` | archives to retain for this campaign (default 14) |
| `COMPRESS` | `0` to keep raw `.json` (default gzips) |
| `CURL_TIMEOUT` | seconds (default 600 — big image sets are slow) |

Keep the DM key out of the crontab line (it would show in `ps`): put it in a
root-only env file.

```bash
# /etc/hexcrawl-backup.env  (chmod 600)
HEXCRAWL_URL=https://hex-crawl.deeznuts.wiki
HEXCRAWL_CAMPAIGN=<campaign id>
HEXCRAWL_DM_KEY=<dm key>
BACKUP_DIR=/var/backups/hexcrawl
KEEP=14
```

Cron (daily 04:15), one line per campaign — repeat with a second env file:

```cron
15 4 * * * root set -a; . /etc/hexcrawl-backup.env; set +a; /usr/local/bin/hexcrawl-backup.sh >> /var/log/hexcrawl-backup.log 2>&1
```

Or a systemd timer:

```ini
# /etc/systemd/system/hexcrawl-backup.service
[Service]
Type=oneshot
EnvironmentFile=/etc/hexcrawl-backup.env
ExecStart=/usr/local/bin/hexcrawl-backup.sh

# /etc/systemd/system/hexcrawl-backup.timer
[Timer]
OnCalendar=*-*-* 04:15:00
Persistent=true
[Install]
WantedBy=timers.target
```

`systemctl enable --now hexcrawl-backup.timer`.

**Test the restore, not just the backup.** Once in a while, POST a recent
archive to `/api/campaigns/import`, open the resulting campaign and confirm the
maps and pins look right. There is no campaign-delete API yet, so do this drill
against a scratch instance (`docker run -e DATA_DIR=/tmp ...`) rather than
production — otherwise the restored copy sticks around (unreachable without its
link, but still on the volume; `DELETE FROM campaign WHERE id = '<id>'` in
`hexcrawl.db` clears it, with the container stopped).

---

## 10. Security

The trust model in one paragraph: **there are no accounts.** A campaign has two
secrets — a player key and a DM key — and knowing one is the entire
authorization story. Following an invite link exchanges the key for a
long-lived `hc_seat_<campaignId>` cookie (HttpOnly, SameSite=Lax) that names a
seat; every WebSocket command and REST call is authorized from that seat. The
DM key doubles as the Bearer token for the integration API and as `?key=` on
the export endpoint, so it is the crown jewel: it grants full DM access,
including a complete campaign archive. Player-visible data is filtered
server-side (`shared/src/rules/filter.ts`) — clients never receive DM notes,
hidden content, or fogged terrain, so a hostile player's dev tools buy nothing.
Uploaded images are served from unguessable paths under `/uploads/` and are
**not** access-controlled; treat a leaked image URL as public.

What that leaves exposed, and what the app now does about it:

| Risk | Mitigation | Knob |
|---|---|---|
| Brute-forcing an invite key | Per-IP sliding-window rate limits on join, campaign create, import, and export; 429 + `Retry-After` | `RATE_LIMIT_*`, `TRUST_PROXY` |
| A leaked link (pasted in a public Discord, an ex-player, a rotated laptop) | DM can regenerate either key from *Settings → Invite links*; old links die instantly, seated browsers stay connected | — |
| Drive-by campaign creation on a public instance | Optional instance password on create **and** restore | `CREATE_PASSWORD` |
| Malicious "image" uploads | Magic-byte sniffing (PNG/JPEG/WebP only); the client's Content-Type and filename are ignored, the stored extension comes from the bytes | — |
| Disk exhaustion via uploads | 30 MB per file plus a per-campaign total quota (413 past it) | `UPLOAD_QUOTA_MB` |

Operational notes:

- **`TRUST_PROXY` must match reality.** Behind Traefik (the deployment above)
  leave it on, or every client shares one rate-limit bucket. Exposed directly,
  set `TRUST_PROXY=0` — otherwise a client spoofs `X-Forwarded-For` and the
  limits do nothing.
- **The limiter is in-memory and per-process.** One container is the supported
  topology; running several behind a load balancer divides every limit by the
  number of instances.
- **Rotating the DM key breaks integrations.** The MCP server's
  `HEXCRAWL_TOKEN`, `/etc/hexcrawl-backup.env`'s `HEXCRAWL_DM_KEY`, and any
  saved `?key=` URLs all carry the old value. Rotate, then update them in the
  same maintenance window, then run the backup script once by hand to confirm.
- **Always terminate TLS in front of the app.** The seat cookie is not marked
  `Secure`, and invite keys travel in URLs; plain HTTP over the open internet
  hands both to anyone on the path.
- **Uploads are public-by-URL.** Do not put spoiler maps in an instance whose
  `/uploads/` you would mind being fetched by anyone holding the link.
- **Still missing** (issue #80's remaining bullets): seat expiry, kick+ban, and
  a per-campaign seat cap. A removed seat can re-join with the same invite key,
  so the ban story today is "rotate the key and re-invite everyone else".

---

## 11. Storage backend: SQLite (default) or PostgreSQL

Rows live in **SQLite** under `DATA_DIR` unless `DATABASE_URL` is set. That is
the supported, one-command path and what the deployment above uses — the LUN in
§2 exists precisely because the database file must sit on a *block* device.

**Do not put `hexcrawl.db` on NFS/SMB.** SQLite's WAL mode needs shared-memory
locking that network filesystems do not provide honestly; the failure mode is a
silently corrupted database, not an error. If your only storage is a file
server, use Postgres instead.

```bash
# .env / compose environment
DATABASE_URL=postgres://hexcrawl:<password>@db.example.com:5432/hexcrawl
```

Set it and the server keeps *rows* in Postgres. Everything else is unchanged:
**uploaded images still live on disk under `DATA_DIR/uploads`**, so that
directory still needs to be a persistent volume, and it is still part of a
backup. Schema migrations run automatically at boot exactly as they do on
SQLite (`packages/server/src/db/index.ts`).

The database user needs `CREATE TABLE` on its schema — the server owns the
schema and runs its own migrations. An empty database is all the provisioning
required.

### Migrating an existing instance from SQLite to Postgres

The per-campaign archive from §9b is the vehicle: it is a plain JSON document
of rows plus base64 images and is backend-independent.

```bash
# 1. Export every campaign from the running SQLite instance.
curl -fsSL -o campaign-<id>.json \
  "https://hex-crawl.deeznuts.wiki/api/campaigns/<id>/export?key=<DM_KEY>"

# 2. Bring up a second instance pointed at the empty Postgres database.
#    (Same image, same DATA_DIR volume layout, plus DATABASE_URL.)

# 3. Import each archive into it.
curl -fsS -X POST -H 'Content-Type: application/json' \
  --data-binary @campaign-<id>.json \
  "https://<new-instance>/api/campaigns/import"
```

Import mints **new ids and new invite keys**, so hand out the new links
afterwards (`/api/campaigns/<newId>/keys`). Seats are not restored: everyone
re-joins, and the importer becomes the DM. Check the `imported` counts in the
response against the archive before decommissioning the old instance.

There is no in-place converter, and that is deliberate — export/import is the
one migration path that is already exercised by tests and by the nightly backup
script.

### Operating the Postgres backend

- **One writer.** The server keeps every campaign in memory and writes through
  to the database; it does not read rows back at request time. Run exactly one
  container against a given database. Postgres removes the *filesystem*
  constraint, not the single-process one.
- **Writes are queued, not awaited.** Statements are applied in order on a
  single connection. A statement that fails is logged as `[db] WRITE FAILED`
  and counted in `/api/health`:

  ```bash
  curl -s http://127.0.0.1:3000/api/health
  # {"ok":true,"db":{"driver":"postgres","pendingWrites":0,"failedWrites":0,...}}
  ```

  **Alert on `failedWrites > 0`.** It means memory and the database have
  diverged for some campaign. The fix is to restart the container, which
  reloads every campaign from the database — losing the diverged writes but
  restoring a consistent state. `pendingWrites` sitting high means the database
  is slower than the table is; it drains on its own.
- **Boot loads every campaign** before the port opens, so startup grows with
  the number of campaigns. A slow boot on a large instance is expected.
- **Shutdown flushes.** `SIGTERM`/`SIGINT` drain the write queue before exit,
  so use `docker stop` (not `docker kill`) and leave a grace period.
- **Back up both halves**: `pg_dump` for the rows *and* `DATA_DIR/uploads` for
  the images. The per-campaign export in §9b still covers both in one file and
  works identically on this backend.

### Verifying the Postgres path locally

CI runs the driver's unit tests against a mock client. To exercise a real
server:

```bash
docker run --rm -d -p 5433:5432 -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=hexcrawl_test --name hexcrawl-pg postgres:16
HEXCRAWL_TEST_DATABASE_URL=postgres://postgres:dev@localhost:5433/hexcrawl_test \
  pnpm --filter @hexcrawl/server test
docker rm -f hexcrawl-pg
```

Without that variable the live tests skip (`src/db/postgres-live.test.ts`).
