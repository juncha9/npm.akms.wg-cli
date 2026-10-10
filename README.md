# @akms/wg-cli

> 🔒 Internal use only — built for our organization's servers.

Operator CLI for a WireGuard admin VPN: issue, list, show and revoke peers from a full-screen terminal UI or from short subcommands. The server's own `wg-quick` config is the ledger — each `[Peer]` carries a `# peer: <name> (<date>)` comment above it — so there is no second database to drift.

Ported from the bash script `/home/alkemist/wg/wg-peer` on `ak_api_01` (akms.docs/cloud-migration-audit.md §8 · 관리자 VPN). That script stays the reference behaviour until this package replaces it; both read and write the same ledger.

## 📦 Installation

```bash
sudo npm install -g @akms/wg-cli     # installs `akwg` (and the long name `akms-wg`)
```

Runs as root (`sudo akwg …`) — it calls `wg set` and writes `/etc/wireguard/<iface>.conf`. The host needs a system-wide **Node ≥ 22** that root can see; a Node installed under a service account's nvm is not enough.

## 🚀 Usage

```bash
sudo akwg                  # 화면 모드 (터미널)
sudo akwg ls               # 목록: 이름 · 주소 · 발급일 · 마지막 연결 · 받음/보냄   (= list)
sudo akwg add <name>       # 키 생성 + 등록 + 클라이언트 설정 파일(<clientsDir>/<name>.conf) + QR
sudo akwg show <name>      # 그 설정 파일 · QR 다시 보기(forget 전까지)            (= qr)
sudo akwg rm <name>        # 회수 — 즉시 끊김                                     (= remove)
sudo akwg forget <name>    # 설정 파일(개인키 포함)만 shred — 기기에 넣은 뒤
```

Names: lowercase · digits · hyphen, up to 32 chars. Addresses: `.2` upward in the server's `/24`, lowest free number.

### 화면 모드

```
╭──────────────────────────────────────────────────────────────────────────╮
│ WireGuard 계정 — wg0 · 3대                            3.36.130.147:65000 │
│                                                                          │
│     이름     주소           발급        마지막 연결  받음 / 보냄          │
│ ▸ ● home-pc  10.255.0.2/32  2026-10-11  12초 전      1.2 MiB / 340 KiB   │
│     laptop   10.255.0.3/32  2026-10-11  3일 전       20.0 KiB / 8.0 KiB  │
│     phone    10.255.0.4/32  2026-10-12  없음         0 B / 0 B           │
╰──────────────────────────────────────────────────────────────────────────╯
↑↓ 고르기   a 발급   Enter 설정·QR   d 회수   x 설정파일 지우기   r 새로고침   q 끝
```

- Refreshes every 3 s; `●` marks a peer whose last handshake is under 3 minutes old (WireGuard re-handshakes every 2 minutes while connected).
- `a` opens a name prompt (Enter issues, Esc cancels; paste works); issuing jumps to the QR screen. `d` / `x` ask `y / n`.
- Runs in the terminal's alternate screen — quitting restores the shell exactly as it was. Ctrl+C also quits.
- Only screen mode loads React/Ink (a separate chunk); `akwg ls` and the other subcommands stay light.

## ⚙️ Settings — `/etc/akms-wg.json` (optional)

```json
{
    "iface": "wg0",
    "clientAllowedIps": ["10.0.0.0/16"],
    "endpointHost": null,
    "clientsDir": "/home/alkemist/wg/clients",
    "keepaliveSeconds": 25
}
```

- `clientAllowedIps` — what the client routes through the tunnel, in addition to the pool itself. Put the VPC CIDR here.
- `endpointHost` — leave `null` on AWS; the public IPv4 is read from instance metadata (IMDSv2) at issue time.
- `clientsDir` — where issued configs (with private keys) land, owned by the `sudo` caller, mode 600. Default `~/.akms-wg/clients` of that caller.
- `AKMS_WG_SETTINGS=<path>` points at a different settings file (tests, a second interface).

## 🛠️ Development status (2026-10-11)

**0.0.1 — built, tested, verified on the target host; not yet committed, published or installed.**

| | |
|---|---|
| `npm test` | 12 tests — ledger round trip (append two → remove both → byte-identical), name-prefix safety, unledgered `[Peer]`, address allocation, display-width table alignment, client config shape |
| `npm run build` | library: ESM + CJS + d.ts (no UI). CLI: ESM with code splitting — `lib/cli.js` has no static `ink`/`react` import; the TUI is a lazily imported chunk |
| On `ak_api_01` | tarball installed into a throwaway prefix, run as root against the live `wg0` via `AKMS_WG_SETTINGS`. Subcommands and aliases (`ls` · `add` · `qr` · `rm` · `forget`) and error paths. Screen mode driven through a pty: issue by typed name and by pasted `name\r` (both land, QR shown), ↓ + `d` + `y` revokes the second row, `x` + `y` shreds the config file, `d` + `y` revokes. The bash `wg-peer` reads the same ledger. After every run the ledger ended with 0 peers and its original shape. |

Found while testing: Ink delivers fast typing or a paste as **one multi-character `input`**; the first version accepted only single characters and silently dropped the name. Add-mode now consumes the chunk character by character and treats an Enter inside it as submit.

Layout:

- `src/_libs/ledger.ts` — pure config parsing (`parsePeers`, `appendPeer`, `removePeer`, `nextFreeAddress`, …); what the tests cover
- `src/_libs/wg.ts` — the only place that calls the `wg` binary
- `src/modules/peers.ts` — operations. `add` registers in the kernel first, then writes the ledger (rolls the kernel back if that fails). `remove` writes the ledger first, then the kernel — the other order lets a reboot resurrect a revoked device when the ledger write fails.
- `src/modules/output.ts` — table, QR, shared by the TUI and the subcommands
- `src/tui/` — Ink screen (`app.tsx`) and the alternate-screen runner (`run.tsx`)
- `src/cli.ts` — dispatch, aliases, root check

Remaining:

1. **System Node on the server** — root needs a `node` (≥ 22) on its PATH; the only Node there is under the `app` account's nvm. Install Node 24 from NodeSource so `sudo npm i -g` lands in `/usr/lib/node_modules`.
2. `/etc/akms-wg.json` on the server: `{"clientAllowedIps": ["10.0.0.0/16"], "clientsDir": "/home/alkemist/wg/clients"}`.
3. First commit, publish (`npm-publish` skill), `sudo npm i -g @akms/wg-cli`, compare `sudo akwg ls` with `sudo ~/wg/wg-peer list`, then retire the bash script.

## License

MIT
