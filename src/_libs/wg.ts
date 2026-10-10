import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// `wg` 바이너리를 부르는 자리 — 전부 여기로 모아 두면 커널을 건드리는 곳이 한 파일이다.

async function wg(args: readonly string[], input?: string): Promise<string> {
    const child = execFileAsync("wg", [...args], { encoding: "utf8", maxBuffer: 1024 * 1024 });
    if(input != null && child.child.stdin != null) {
        child.child.stdin.end(input);
    }
    const result = await child;
    return result.stdout;
}

export async function generatePrivateKey(): Promise<string> {
    const output = await wg(["genkey"]);
    return output.trim();
}

export async function derivePublicKey(privateKey: string): Promise<string> {
    const output = await wg(["pubkey"], `${privateKey}\n`);
    return output.trim();
}

export async function showPublicKey(iface: string): Promise<string> {
    const output = await wg(["show", iface, "public-key"]);
    return output.trim();
}

export async function showListenPort(iface: string): Promise<number> {
    const output = await wg(["show", iface, "listen-port"]);
    return Number(output.trim());
}

/** 커널에 등록된 피어 공개키 목록. */
export async function showPeers(iface: string): Promise<string[]> {
    const output = await wg(["show", iface, "peers"]);
    return output.split("\n").map((line) => line.trim()).filter((line) => line != "");
}

/** 공개키 → 마지막 핸드셰이크 epoch 초(0 = 없음). */
export async function showHandshakes(iface: string): Promise<Map<string, number>> {
    const output = await wg(["show", iface, "latest-handshakes"]);
    const map = new Map<string, number>();
    for(const line of output.split("\n")) {
        const [key, seconds] = line.trim().split(/\s+/);
        if(key != null && key != "") {
            map.set(key, Number(seconds));
        }
    }
    return map;
}

/** 공개키 → [받은 바이트, 보낸 바이트]. */
export async function showTransfer(iface: string): Promise<Map<string, [number, number]>> {
    const output = await wg(["show", iface, "transfer"]);
    const map = new Map<string, [number, number]>();
    for(const line of output.split("\n")) {
        const [key, received, sent] = line.trim().split(/\s+/);
        if(key != null && key != "") {
            map.set(key, [Number(received), Number(sent)]);
        }
    }
    return map;
}

export async function setPeer(iface: string, publicKey: string, allowedIps: string): Promise<void> {
    await wg(["set", iface, "peer", publicKey, "allowed-ips", allowedIps]);
}

export async function removePeerLive(iface: string, publicKey: string): Promise<void> {
    await wg(["set", iface, "peer", publicKey, "remove"]);
}
