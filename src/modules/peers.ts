import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import dayjs from "dayjs";

import { DEFAULT_CONF_DIR, DEFAULT_LOCK_PATH, PEER_NAME_PATTERN } from "@/_defs";
import {
    acquireLock,
    appendPeer,
    fetchPublicIpv4FromImds,
    nextFreeAddress,
    parsePeers,
    poolPrefixOf,
    readInterfaceValue,
    removePeer as removePeerFromLedger,
    resolveClientsDir,
    wg,
} from "@/_libs";
import type { PeerEntry, PeerStatus, ServerInfo, Settings } from "@/_types";

import { WgCliError } from "./errors";

const execFileAsync = promisify(execFile);

// 대장에 없는데 커널에만 있는 피어 — 손으로 `wg set` 했거나 대장이 어긋난 것. 목록에서 눈에 띄게.
export const UNLEDGERED_NAME = "(대장에 없음)";
const ENDPOINT_HOST_PLACEHOLDER = "<서버 공인 주소>";

export interface IssuedPeer {
    readonly name: string;
    /** `10.255.0.2` */
    readonly address: string;
    /** 클라이언트 설정 파일 — 개인키가 들어 있다. */
    readonly filePath: string;
    readonly clientConf: string;
}

export interface PeerDetail {
    readonly entry: PeerEntry;
    /** 아직 지우지 않은 클라이언트 설정 파일. forget 뒤에는 null. */
    readonly filePath: string | null;
    readonly clientConf: string | null;
}

export function confPathOf(settings: Settings): string {
    return path.join(DEFAULT_CONF_DIR, `${settings.iface}.conf`);
}

export function clientFilePathOf(settings: Settings, name: string): string {
    const clients = resolveClientsDir(settings);
    return path.join(clients.dir, `${name}.conf`);
}

/** 클라이언트에게 건넬 wg-quick 설정. `AllowedIPs` 는 설정의 대역들 + 주소 풀. */
export function buildClientConf(args: {
    privateKey: string;
    address: string;
    server: ServerInfo;
    endpointHost: string;
    allowedIps: readonly string[];
    keepaliveSeconds: number;
}): string {
    const lines = [
        "[Interface]",
        `PrivateKey = ${args.privateKey}`,
        `Address = ${args.address}/32`,
        "",
        "[Peer]",
        `PublicKey = ${args.server.publicKey}`,
        `AllowedIPs = ${[...args.allowedIps, args.server.poolCidr].join(", ")}`,
        `Endpoint = ${args.endpointHost}:${args.server.listenPort}`,
        `PersistentKeepalive = ${args.keepaliveSeconds}`,
    ];
    return `${lines.join("\n")}\n`;
}

function readLedger(confPath: string): string {
    if(fs.existsSync(confPath) == false) {
        throw new WgCliError(`${confPath} 가 없습니다 — WireGuard 서버 설정이 먼저 있어야 합니다`);
    }
    return fs.readFileSync(confPath, "utf8");
}

/** 바꾸기 전 `.bak` 하나를 남기고, 같은 폴더의 임시 파일을 rename 해서 반쯤 쓴 대장이 남지 않게. */
function writeLedger(confPath: string, content: string): void {
    const backupPath = `${confPath}.bak`;
    fs.copyFileSync(confPath, backupPath);
    fs.chmodSync(backupPath, 0o600);
    const temporaryPath = `${confPath}.tmp-${process.pid}`;
    fs.writeFileSync(temporaryPath, content, { mode: 0o600 });
    fs.renameSync(temporaryPath, confPath);
}

async function readServerInfo(settings: Settings, conf: string): Promise<ServerInfo> {
    const addressValue = readInterfaceValue(conf, "Address");
    if(addressValue == null) {
        throw new WgCliError("설정 파일의 [Interface] 에 Address 가 없습니다");
    }
    const poolPrefix = poolPrefixOf(addressValue);
    const publicKey = await wg.showPublicKey(settings.iface);
    const listenPort = await wg.showListenPort(settings.iface);
    return {
        publicKey: publicKey,
        listenPort: listenPort,
        address: addressValue.split("/")[0],
        poolCidr: `${poolPrefix}.0/24`,
    };
}

/** 개인키가 든 파일을 지운다 — `shred` 가 있으면 덮어쓰고 지우고, 없으면 0 으로 덮은 뒤 지운다. */
async function shredFile(filePath: string): Promise<void> {
    try {
        await execFileAsync("shred", ["-u", filePath]);
        return;
    }
    catch {
        // shred 가 없거나 실패 — 아래에서 직접
    }
    const size = fs.statSync(filePath).size;
    fs.writeFileSync(filePath, Buffer.alloc(size));
    fs.unlinkSync(filePath);
}

/** Endpoint 의 호스트 — 설정 → AWS 메타데이터 → 자리 표시 순. 발급할 때마다 다시 읽어 공인 IP 가 바뀌어도 맞는 값이 들어간다. */
async function resolveEndpointHost(settings: Settings): Promise<string> {
    if(settings.endpointHost != null) {
        return settings.endpointHost;
    }
    const imdsHost = await fetchPublicIpv4FromImds();
    if(imdsHost != null) {
        return imdsHost;
    }
    return ENDPOINT_HOST_PLACEHOLDER;
}

/** 화면 머리줄용 `호스트:포트`. */
export async function readEndpoint(settings: Settings): Promise<string> {
    const host = await resolveEndpointHost(settings);
    const port = await wg.showListenPort(settings.iface);
    return `${host}:${port}`;
}

/** 대장 + 커널 상태. 커널에만 있는 피어도 `(대장에 없음)` 으로 함께 — 어긋남을 숨기지 않는다. */
export async function listPeers(settings: Settings): Promise<PeerStatus[]> {
    const conf = readLedger(confPathOf(settings));
    const entries = parsePeers(conf);
    const handshakes = await wg.showHandshakes(settings.iface);
    const transfer = await wg.showTransfer(settings.iface);

    const statuses: PeerStatus[] = [];
    const ledgerKeys = new Set<string>();
    for(const entry of entries) {
        ledgerKeys.add(entry.publicKey);
        const handshakeAt = handshakes.get(entry.publicKey) ?? 0;
        const bytes = transfer.get(entry.publicKey) ?? [0, 0];
        let lastHandshakeAt: number | null = null;
        if(handshakeAt > 0) {
            lastHandshakeAt = handshakeAt;
        }
        statuses.push({ ...entry, lastHandshakeAt: lastHandshakeAt, receivedBytes: bytes[0], sentBytes: bytes[1] });
    }
    for(const [publicKey, handshakeAt] of handshakes) {
        if(ledgerKeys.has(publicKey) == true) {
            continue;
        }
        const bytes = transfer.get(publicKey) ?? [0, 0];
        let lastHandshakeAt: number | null = null;
        if(handshakeAt > 0) {
            lastHandshakeAt = handshakeAt;
        }
        statuses.push({
            name: UNLEDGERED_NAME,
            issuedOn: null,
            allowedIps: "",
            publicKey: publicKey,
            lastHandshakeAt: lastHandshakeAt,
            receivedBytes: bytes[0],
            sentBytes: bytes[1],
        });
    }
    return statuses;
}

/**
 * 발급: 키를 만들고, 커널에 먼저 올린 뒤 대장에 적고, 클라이언트 설정 파일을 남긴다.
 *
 * Flow:
 *  1) 이름 검사 · 잠금
 *  2) 대장 읽기 — 이름 중복 · 다음 빈 주소
 *  3) 키 생성 → 커널 등록(`wg set`) — 여기서 실패하면 아무것도 안 바뀐 것
 *  4) 대장 기록 — 실패하면 커널 등록을 되돌린다(재부팅 때 사라질 피어를 남기지 않게)
 *  5) 클라이언트 설정 파일(600, 부른 계정 소유)
 */
export async function addPeer(settings: Settings, name: string): Promise<IssuedPeer> {
    // (1) 이름 · 잠금
    if(PEER_NAME_PATTERN.test(name) == false) {
        throw new WgCliError(`이름은 소문자 · 숫자 · 하이픈, 32자까지: ${name}`);
    }
    const release = acquireLock(DEFAULT_LOCK_PATH);
    try {
        // (2) 대장
        const confPath = confPathOf(settings);
        const conf = readLedger(confPath);
        const entries = parsePeers(conf);
        if(entries.some((entry) => entry.name == name) == true) {
            throw new WgCliError(`이미 있는 이름: ${name}`);
        }
        const server = await readServerInfo(settings, conf);
        const poolPrefix = server.poolCidr.replace(/\.0\/24$/, "");
        const address = nextFreeAddress(poolPrefix, entries);

        // (3) 키 · 커널
        const privateKey = await wg.generatePrivateKey();
        const publicKey = await wg.derivePublicKey(privateKey);
        const entry: PeerEntry = {
            name: name,
            issuedOn: dayjs().format("YYYY-MM-DD"),
            allowedIps: `${address}/32`,
            publicKey: publicKey,
        };
        await wg.setPeer(settings.iface, publicKey, entry.allowedIps);

        // (4) 대장
        try {
            writeLedger(confPath, appendPeer(conf, entry));
        }
        catch(error) {
            await wg.removePeerLive(settings.iface, publicKey);
            throw error;
        }

        // (5) 클라이언트 설정 파일
        const endpointHost = await resolveEndpointHost(settings);
        const clientConf = buildClientConf({
            privateKey: privateKey,
            address: address,
            server: server,
            endpointHost: endpointHost,
            allowedIps: settings.clientAllowedIps,
            keepaliveSeconds: settings.keepaliveSeconds,
        });
        const clients = resolveClientsDir(settings);
        const firstCreated = fs.mkdirSync(clients.dir, { recursive: true, mode: 0o700 });
        if(firstCreated != null) {
            // 새로 만든 폴더들은 root 소유로 생긴다 — 부른 계정이 열 수 있게 차례로 넘긴다
            let current = clients.dir;
            while(current.length >= firstCreated.length) {
                fs.chownSync(current, clients.uid, clients.gid);
                current = path.dirname(current);
            }
        }
        const filePath = path.join(clients.dir, `${name}.conf`);
        fs.writeFileSync(filePath, clientConf, { mode: 0o600 });
        fs.chownSync(filePath, clients.uid, clients.gid);

        return { name: name, address: address, filePath: filePath, clientConf: clientConf };
    }
    finally {
        release();
    }
}

export async function showPeer(settings: Settings, name: string): Promise<PeerDetail> {
    const entries = parsePeers(readLedger(confPathOf(settings)));
    const entry = entries.find((item) => item.name == name);
    if(entry == null) {
        throw new WgCliError(`없는 이름: ${name}`);
    }
    const filePath = clientFilePathOf(settings, name);
    if(fs.existsSync(filePath) == false) {
        return { entry: entry, filePath: null, clientConf: null };
    }
    const clientConf = fs.readFileSync(filePath, "utf8");
    return { entry: entry, filePath: filePath, clientConf: clientConf };
}

/**
 * 회수: 대장에서 먼저 빼고 커널에서 뺀다. 순서가 거꾸로면 대장 기록이 실패했을 때
 * 재부팅 · `wg-quick` 재시작이 회수한 기기를 되살린다. 클라이언트 설정 파일도 지운다.
 */
export async function removePeer(settings: Settings, name: string): Promise<PeerEntry> {
    const release = acquireLock(DEFAULT_LOCK_PATH);
    try {
        const confPath = confPathOf(settings);
        const conf = readLedger(confPath);
        const entry = parsePeers(conf).find((item) => item.name == name);
        if(entry == null) {
            throw new WgCliError(`없는 이름: ${name}`);
        }
        writeLedger(confPath, removePeerFromLedger(conf, name));
        try {
            await wg.removePeerLive(settings.iface, entry.publicKey);
        }
        catch(error) {
            throw new WgCliError(`대장에서는 뺐지만 커널에서 빼지 못했습니다 — 'sudo wg set ${settings.iface} peer ${entry.publicKey} remove' 로 직접 빼세요 (${String(error)})`);
        }
        const filePath = clientFilePathOf(settings, name);
        if(fs.existsSync(filePath) == true) {
            await shredFile(filePath);
        }
        return entry;
    }
    finally {
        release();
    }
}

/** 건넨 뒤: 클라이언트 설정 파일(개인키)만 지운다. 등록은 그대로. 지울 파일이 없으면 false. */
export async function forgetPeer(settings: Settings, name: string): Promise<boolean> {
    const filePath = clientFilePathOf(settings, name);
    if(fs.existsSync(filePath) == false) {
        return false;
    }
    await shredFile(filePath);
    return true;
}
