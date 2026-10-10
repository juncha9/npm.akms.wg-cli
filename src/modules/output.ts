import qrcode from "qrcode-terminal";

import type { PeerStatus } from "@/_types";

import type { IssuedPeer } from "./peers";

// 하위 명령과 메뉴가 같은 모양으로 찍도록 출력은 여기 한 곳에서.

/** 화면에서 차지하는 칸 — 한글 · 한자 · 전각은 두 칸. 표의 열을 맞출 때 글자 수가 아니라 이것으로 채운다. */
export function displayWidth(text: string): number {
    let width = 0;
    for(const character of text) {
        const code = character.codePointAt(0) ?? 0;
        const isWide =
            (code >= 0x1100 && code <= 0x115f) ||
            (code >= 0x2e80 && code <= 0xa4cf) ||
            (code >= 0xac00 && code <= 0xd7a3) ||
            (code >= 0xf900 && code <= 0xfaff) ||
            (code >= 0xfe30 && code <= 0xfe4f) ||
            (code >= 0xff00 && code <= 0xff60) ||
            (code >= 0xffe0 && code <= 0xffe6);
        if(isWide == true) {
            width += 2;
        }
        else {
            width += 1;
        }
    }
    return width;
}

export function padEnd(text: string, width: number): string {
    const gap = width - displayWidth(text);
    if(gap <= 0) {
        return text;
    }
    return text + " ".repeat(gap);
}

export function formatBytes(bytes: number): string {
    const units = ["B", "KiB", "MiB", "GiB", "TiB"];
    let value = bytes;
    let unitIndex = 0;
    while(value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    if(unitIndex == 0) {
        return `${value} B`;
    }
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/** 마지막 핸드셰이크 — 2분 안이면 지금 붙어 있는 것(WireGuard 는 2분마다 다시 맞춘다). */
export function formatLastSeen(lastHandshakeAt: number | null, nowSeconds: number): string {
    if(lastHandshakeAt == null) {
        return "없음";
    }
    const elapsed = Math.max(0, nowSeconds - lastHandshakeAt);
    if(elapsed < 60) {
        return `${elapsed}초 전`;
    }
    if(elapsed < 3600) {
        return `${Math.floor(elapsed / 60)}분 전`;
    }
    if(elapsed < 86400) {
        return `${Math.floor(elapsed / 3600)}시간 전`;
    }
    return `${Math.floor(elapsed / 86400)}일 전`;
}

export function renderPeerTable(peers: readonly PeerStatus[], nowSeconds: number): string {
    if(peers.length == 0) {
        return "발급한 계정이 없습니다.";
    }
    const rows: string[][] = [["이름", "주소", "발급", "마지막 연결", "받음 / 보냄"]];
    for(const peer of peers) {
        rows.push([
            peer.name,
            peer.allowedIps,
            peer.issuedOn ?? "-",
            formatLastSeen(peer.lastHandshakeAt, nowSeconds),
            `${formatBytes(peer.receivedBytes)} / ${formatBytes(peer.sentBytes)}`,
        ]);
    }
    const columnCount = rows[0].length;
    const widths: number[] = [];
    for(let column = 0; column < columnCount; column += 1) {
        widths.push(Math.max(...rows.map((row) => displayWidth(row[column]))));
    }
    const lines = rows.map((row) => row.map((cell, column) => {
        if(column == columnCount - 1) {
            return cell;
        }
        return padEnd(cell, widths[column]);
    }).join("  "));
    return lines.join("\n");
}

export function renderQr(text: string): string {
    let rendered = "";
    qrcode.generate(text, { small: true }, (output) => {
        rendered = output;
    });
    return rendered;
}

/** 발급 · 다시 보기 화면 — 파일 경로, 넣는 법, QR. 설정 본문(개인키)은 화면에 찍지 않는다 — 파일과 QR 로만. */
export function renderIssued(issued: Pick<IssuedPeer, "name" | "filePath" | "clientConf"> & { address?: string }): string {
    const lines: string[] = [];
    if(issued.address != null) {
        lines.push(`발급: ${issued.name} → ${issued.address}`);
    }
    else {
        lines.push(`== ${issued.name} ==`);
    }
    lines.push(`설정 파일: ${issued.filePath}  (개인키가 들어 있다 — 건넨 뒤 'forget ${issued.name}' 으로 지운다)`);
    lines.push("PC: 이 파일을 WireGuard 앱의 '파일에서 터널 가져오기' 로.  휴대폰: 아래 QR 을 WireGuard 앱으로 찍는다.");
    lines.push("");
    lines.push(renderQr(issued.clientConf));
    return lines.join("\n");
}
