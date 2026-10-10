import { FIRST_CLIENT_HOST, LAST_CLIENT_HOST } from "@/_defs";
import type { PeerEntry } from "@/_types";

// 대장 = wg-quick 설정 파일 그 자체. 피어마다 바로 위에 "# peer: <이름> (<날짜>)" 주석이 붙는다.
// 이 파일은 순수 문자열 처리만 한다 — 디스크 · 커널은 건드리지 않아서 그대로 시험할 수 있다.

const PEER_COMMENT_PATTERN = /^# peer: (\S+)(?: \((\d{4}-\d{2}-\d{2})\))?\s*$/;

/** 설정 본문에서 `[Peer]` 블록을 차례로 읽는다. 주석이 없는 블록은 이름 `-`. */
export function parsePeers(conf: string): PeerEntry[] {
    const entries: PeerEntry[] = [];
    let pendingName: string | null = null;
    let pendingDate: string | null = null;
    let inPeer = false;
    let name = "-";
    let issuedOn: string | null = null;
    let publicKey = "";
    let allowedIps = "";

    const flush = (): void => {
        if(inPeer == true && publicKey != "") {
            entries.push({ name: name, issuedOn: issuedOn, allowedIps: allowedIps, publicKey: publicKey });
        }
        inPeer = false;
        name = "-";
        issuedOn = null;
        publicKey = "";
        allowedIps = "";
    };

    for(const rawLine of conf.split("\n")) {
        const line = rawLine.trimEnd();
        const comment = PEER_COMMENT_PATTERN.exec(line);
        if(comment != null) {
            flush();
            pendingName = comment[1];
            pendingDate = comment[2] ?? null;
            continue;
        }
        if(line == "[Peer]") {
            flush();
            inPeer = true;
            name = pendingName ?? "-";
            issuedOn = pendingDate;
            pendingName = null;
            pendingDate = null;
            continue;
        }
        if(line.startsWith("[") == true) {
            flush();
            pendingName = null;
            pendingDate = null;
            continue;
        }
        if(line.trim() == "") {
            flush();
            continue;
        }
        if(inPeer == false) {
            continue;
        }
        const keyValue = /^(\w+)\s*=\s*(.*)$/.exec(line);
        if(keyValue == null) {
            continue;
        }
        if(keyValue[1] == "PublicKey") {
            publicKey = keyValue[2].trim();
        }
        if(keyValue[1] == "AllowedIPs") {
            allowedIps = keyValue[2].trim();
        }
    }
    flush();
    return entries;
}

/** `[Interface]` 의 한 값 — `Address`, `ListenPort` 등. 없으면 null. */
export function readInterfaceValue(conf: string, key: string): string | null {
    let inInterface = false;
    for(const rawLine of conf.split("\n")) {
        const line = rawLine.trim();
        if(line.startsWith("[") == true) {
            inInterface = line == "[Interface]";
            continue;
        }
        if(inInterface == false) {
            continue;
        }
        const keyValue = /^(\w+)\s*=\s*(.*)$/.exec(line);
        if(keyValue != null && keyValue[1] == key) {
            return keyValue[2].trim();
        }
    }
    return null;
}

/** 대장 끝에 피어 블록 하나를 더한 본문. 앞 내용은 그대로, 블록 앞에 빈 줄 하나. */
export function appendPeer(conf: string, entry: PeerEntry): string {
    const trimmed = conf.replace(/\s+$/, "");
    let datePart = "";
    if(entry.issuedOn != null) {
        datePart = ` (${entry.issuedOn})`;
    }
    const block = [
        `# peer: ${entry.name}${datePart}`,
        "[Peer]",
        `PublicKey = ${entry.publicKey}`,
        `AllowedIPs = ${entry.allowedIps}`,
    ].join("\n");
    return `${trimmed}\n\n${block}\n`;
}

/** 이름이 붙은 피어 블록을 뺀 본문. 빈 줄은 하나로 모으고 끝의 빈 줄은 없앤다 — 발급 · 회수를 거듭해도 파일이 자라지 않게. */
export function removePeer(conf: string, name: string): string {
    const output: string[] = [];
    let skipping = false;
    let pendingBlank = false;
    for(const rawLine of conf.split("\n")) {
        const line = rawLine.trimEnd();
        const comment = PEER_COMMENT_PATTERN.exec(line);
        if(comment != null && comment[1] == name) {
            skipping = true;
            continue;
        }
        if(skipping == true) {
            if(line.trim() == "") {
                skipping = false;
            }
            continue;
        }
        if(line.trim() == "") {
            pendingBlank = true;
            continue;
        }
        if(pendingBlank == true && output.length > 0) {
            output.push("");
        }
        pendingBlank = false;
        output.push(line);
    }
    return `${output.join("\n")}\n`;
}

/** 서버 `Address`(`10.255.0.1/24`) → 풀 접두(`10.255.0`). /24 만 다룬다 — 관리자 VPN 에는 충분하다. */
export function poolPrefixOf(serverAddress: string): string {
    const match = /^(\d+\.\d+\.\d+)\.\d+\/24$/.exec(serverAddress.trim());
    if(match == null) {
        throw new Error(`server Address must be a /24 like 10.255.0.1/24, got: ${serverAddress}`);
    }
    return match[1];
}

/** 풀에서 아직 안 쓴 가장 낮은 주소. 서버(.1)는 건너뛴다. */
export function nextFreeAddress(poolPrefix: string, peers: readonly PeerEntry[]): string {
    const used = new Set<number>();
    for(const peer of peers) {
        const match = new RegExp(`^${poolPrefix.replaceAll(".", "\\.")}\\.(\\d+)/32$`).exec(peer.allowedIps);
        if(match != null) {
            used.add(Number(match[1]));
        }
    }
    for(let host = FIRST_CLIENT_HOST; host <= LAST_CLIENT_HOST; host += 1) {
        if(used.has(host) == false) {
            return `${poolPrefix}.${host}`;
        }
    }
    throw new Error(`address pool exhausted: ${poolPrefix}.0/24`);
}
