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

The entire state is the `hexcrawl_data` volume (SQLite `hexcrawl.db` + WAL +
`uploads/`). Back up with the same tar-from-volume approach, or snapshot the
zvol on TrueNAS.
