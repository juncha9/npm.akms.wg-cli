#!/usr/bin/env node
import { CLI_VERSION } from "@/_defs";
import { loadSettings } from "@/_libs";

import { WgCliError } from "./modules/errors";
import { renderIssued, renderPeerTable } from "./modules/output";
import { addPeer, clientFilePathOf, forgetPeer, listPeers, removePeer, showPeer } from "./modules/peers";

const USAGE = `akms-wg ${CLI_VERSION} — WireGuard 관리자 VPN 계정 발급 · 회수

  sudo akms-wg               화면 모드 — ↑↓ 로 계정을 골라 Enter: 설정/QR · 설정파일 지우기 · 회수 / 맨 아래 새 계정 발급 · Esc 끝
  sudo akms-wg ls            목록: 이름 · 주소 · 발급일 · 마지막 연결 · 받음/보냄        (= list)
  sudo akms-wg add <이름>    키를 만들어 등록 + 클라이언트 설정 파일 + QR
  sudo akms-wg show <이름>   그 설정 파일 · QR 다시 보기(forget 전까지)                 (= qr)
  sudo akms-wg rm <이름>     회수 — 즉시 끊김                                          (= remove)
  sudo akms-wg forget <이름> 설정 파일(개인키)만 지움 — 기기에 넣은 뒤

  설정: /etc/akms-wg.json (없어도 됨 — README 참고), 경로는 AKMS_WG_SETTINGS 로 바꿀 수 있다
  대장: /etc/wireguard/<iface>.conf 의 "# peer: <이름> (<날짜>)" 주석`;

// 짧은 별칭 → 본 이름. 긴 이름도 그대로 받아서 스크립트가 깨지지 않는다.
const COMMAND_ALIASES: Record<string, string> = {
    ls: "list",
    list: "list",
    add: "add",
    show: "show",
    qr: "show",
    rm: "remove",
    remove: "remove",
    forget: "forget",
};

function requireName(name: string | undefined): string {
    if(name == null || name == "") {
        throw new WgCliError(`이름이 필요합니다\n\n${USAGE}`);
    }
    return name;
}

async function main(argv: readonly string[]): Promise<number> {
    const [rawCommand, name] = argv;

    if(rawCommand == "--help" || rawCommand == "-h" || rawCommand == "help") {
        console.log(USAGE);
        return 0;
    }
    if(rawCommand == "--version" || rawCommand == "-v") {
        console.log(CLI_VERSION);
        return 0;
    }
    let command: string | null = null;
    if(rawCommand != null) {
        command = COMMAND_ALIASES[rawCommand] ?? null;
        if(command == null) {
            console.log(USAGE);
            return 1;
        }
    }
    if(typeof process.getuid !== "function" || process.getuid() != 0) {
        throw new WgCliError(`sudo 로 실행하세요 — wg 설정과 /etc/wireguard 는 root 만 고칠 수 있습니다\n\n${USAGE}`);
    }

    const settings = loadSettings();

    if(command == null) {
        if(process.stdin.isTTY != true) {
            console.log(USAGE);
            return 1;
        }
        // 화면 모드만 React · Ink 를 읽는다 — 하위 명령은 가볍게
        const { runTui } = await import("./tui/run");
        await runTui(settings);
        return 0;
    }
    if(command == "list") {
        const peers = await listPeers(settings);
        console.log(renderPeerTable(peers, Math.floor(Date.now() / 1000)));
        return 0;
    }
    if(command == "add") {
        const issued = await addPeer(settings, requireName(name));
        console.log(renderIssued(issued));
        return 0;
    }
    if(command == "show") {
        const peerName = requireName(name);
        const detail = await showPeer(settings, peerName);
        if(detail.filePath == null || detail.clientConf == null) {
            console.log(`${peerName}: 설정 파일은 이미 지웠습니다 — 개인키는 그 기기에만 있습니다. 다시 필요하면 rm 뒤 add 로 새로 발급하세요.`);
            return 0;
        }
        console.log(renderIssued({ name: peerName, filePath: detail.filePath, clientConf: detail.clientConf }));
        return 0;
    }
    if(command == "remove") {
        const removed = await removePeer(settings, requireName(name));
        console.log(`회수: ${removed.name} (${removed.allowedIps}) — 즉시 연결이 끊깁니다`);
        return 0;
    }
    // forget
    const peerName = requireName(name);
    const removed = await forgetPeer(settings, peerName);
    if(removed == true) {
        console.log(`지움: ${clientFilePathOf(settings, peerName)} (등록은 그대로)`);
    }
    else {
        console.log(`지울 파일이 없습니다: ${clientFilePathOf(settings, peerName)}`);
    }
    return 0;
}

main(process.argv.slice(2))
    .then((code) => {
        process.exitCode = code;
    })
    .catch((error: unknown) => {
        if(error instanceof WgCliError) {
            console.error(`오류: ${error.message}`);
            process.exitCode = 1;
            return;
        }
        console.error("예상하지 못한 오류:", error);
        process.exitCode = 2;
    });
