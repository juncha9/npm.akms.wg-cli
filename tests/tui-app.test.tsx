import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { render } from "ink-testing-library";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerStatus, Settings } from "@/_types";

// 화면 흐름만 본다 — wg · 대장 · 파일을 건드리는 peers 모듈은 가짜로.
const CLIENTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "akms-wg-tui-"));
const NOW_SECONDS = Math.floor(Date.now() / 1000);
const PEERS: PeerStatus[] = [
    { name: "home-pc", issuedOn: "2026-10-11", allowedIps: "10.255.0.2/32", publicKey: "KEY-HOME", lastHandshakeAt: NOW_SECONDS - 10, receivedBytes: 2048, sentBytes: 1024 },
    { name: "laptop", issuedOn: "2026-10-11", allowedIps: "10.255.0.3/32", publicKey: "KEY-LAPTOP", lastHandshakeAt: null, receivedBytes: 0, sentBytes: 0 },
    { name: "(대장에 없음)", issuedOn: null, allowedIps: "", publicKey: "KEY-STRAY", lastHandshakeAt: null, receivedBytes: 0, sentBytes: 0 },
];

const peersModule = vi.hoisted(() => ({
    UNLEDGERED_NAME: "(대장에 없음)",
    listPeers: vi.fn(),
    addPeer: vi.fn(),
    removePeer: vi.fn(),
    forgetPeer: vi.fn(),
    showPeer: vi.fn(),
    clientFilePathOf: vi.fn(),
}));
vi.mock("@/modules/peers", () => peersModule);

const { App } = await import("@/tui/app");

const SETTINGS: Settings = { iface: "wg0", clientAllowedIps: [], endpointHost: null, clientsDir: null, keepaliveSeconds: 25 };

const KEY_DOWN = "\u001b[B";
const KEY_ENTER = "\r";
const KEY_ESCAPE = "\u001b";

async function press(stdin: { write: (data: string) => void }, key: string): Promise<void> {
    stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 60));
}

async function waitForFrame(lastFrame: () => string | undefined, text: string): Promise<string> {
    for(let attempt = 0; attempt < 50; attempt += 1) {
        const frame = lastFrame() ?? "";
        if(frame.includes(text) == true) {
            return frame;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`frame never showed "${text}":\n${lastFrame()}`);
}

function pointedLines(frame: string): string[] {
    return frame.split("\n").filter((line) => line.includes("❯ "));
}

let cleanup: (() => void) | null = null;

beforeEach(() => {
    vi.clearAllMocks();
    peersModule.listPeers.mockResolvedValue(PEERS);
    peersModule.clientFilePathOf.mockImplementation((_settings: Settings, name: string) => path.join(CLIENTS_DIR, `${name}.conf`));
    // home-pc 만 설정 파일이 남아 있다 — laptop 은 forget 한 뒤
    fs.writeFileSync(path.join(CLIENTS_DIR, "home-pc.conf"), "[Interface]\n");
});

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

afterAll(() => {
    fs.rmSync(CLIENTS_DIR, { recursive: true, force: true });
});

describe("TUI", () => {
    it("lists peers as the menu, with the actions below them", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;

        const frame = await waitForFrame(view.lastFrame, "home-pc");
        expect(frame).toContain("? 3대 — 골라서 관리");
        expect(frame).toContain("이름");
        expect(frame).toContain("새 계정 발급");
        expect(frame).toContain("Esc 끝");
        // 커서는 첫 계정에서, 붙어 있는 계정에는 ●
        expect(pointedLines(frame)[0]).toContain("● home-pc");
    });

    it("opens a peer's submenu and revokes only after confirming", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, KEY_ENTER);
        let frame = await waitForFrame(view.lastFrame, "? home-pc — 10.255.0.2/32 · 2026-10-11 발급");
        expect(frame).toContain("설정 · QR 보기");
        expect(frame).toContain("설정 파일 지우기");
        expect(frame).toContain("Esc 뒤로");

        // 회수 → 확인은 "아니요" 에서 시작 — Enter 만 누르면 아무 일도 없이 하위 메뉴의 "회수" 줄로 돌아온다
        await press(view.stdin, KEY_DOWN);
        await press(view.stdin, KEY_DOWN);
        await press(view.stdin, KEY_ENTER);
        frame = await waitForFrame(view.lastFrame, "home-pc 을(를) 회수할까요?");
        expect(pointedLines(frame).at(-1)).toContain("아니요");
        await press(view.stdin, KEY_ENTER);
        expect(peersModule.removePeer).not.toHaveBeenCalled();
        frame = await waitForFrame(view.lastFrame, "Esc 뒤로");
        expect(frame).toContain("? home-pc —");
        expect(pointedLines(frame).at(-1)).toContain("회수");

        // 다시 — 이번에는 "회수" 로 내려가서
        peersModule.removePeer.mockResolvedValue(PEERS[0]);
        await press(view.stdin, KEY_ENTER);
        await press(view.stdin, KEY_DOWN);
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "회수: home-pc");
        expect(peersModule.removePeer).toHaveBeenCalledWith(SETTINGS, "home-pc");
    });

    it("goes back one level from a confirm, to the row that opened it", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, KEY_ENTER);
        await press(view.stdin, KEY_DOWN);
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "설정 파일(개인키 포함)을 지울까요?");
        await press(view.stdin, KEY_ESCAPE);

        const frame = await waitForFrame(view.lastFrame, "Esc 뒤로");
        expect(frame).not.toContain("지울까요?");
        expect(pointedLines(frame).at(-1)).toContain("설정 파일 지우기");
        expect(peersModule.forgetPeer).not.toHaveBeenCalled();
    });

    it("comes back from the QR screen to the account's submenu", async () => {
        peersModule.showPeer.mockResolvedValue({ entry: PEERS[0], filePath: path.join(CLIENTS_DIR, "home-pc.conf"), clientConf: "[Interface]\n" });
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, KEY_ENTER);
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "아무 키나 누르면 돌아갑니다");
        await press(view.stdin, " ");

        const frame = await waitForFrame(view.lastFrame, "Esc 뒤로");
        expect(frame).toContain("? home-pc —");
        expect(pointedLines(frame).at(-1)).toContain("설정 · QR 보기");
    });

    it("leaves the submenu with Esc", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "설정 · QR 보기");
        await press(view.stdin, KEY_ESCAPE);
        const frame = await waitForFrame(view.lastFrame, "Esc 끝");
        expect(frame).not.toContain("설정 · QR 보기");
    });

    it("offers only revoke once the config file is gone", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "laptop");

        await press(view.stdin, "2");
        await press(view.stdin, KEY_ENTER);
        const frame = await waitForFrame(view.lastFrame, "? laptop");
        expect(frame).toContain("설정 파일은 이미 지웠습니다");
        expect(frame).not.toContain("설정 · QR 보기");
        expect(pointedLines(frame).at(-1)).toContain("회수");
    });

    it("explains instead of opening a submenu for an unledgered peer", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "laptop");

        await press(view.stdin, "3");
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "대장에 없는 피어는 'sudo wg' 로 직접 다룹니다");
    });

    it("issues a new peer, lowercasing the name and keeping a rejected one in the field", async () => {
        peersModule.addPeer.mockImplementation(async (_settings: Settings, name: string) => {
            return { name: name, address: "10.255.0.4", filePath: path.join(CLIENTS_DIR, `${name}.conf`), clientConf: "[Interface]\n" };
        });
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, "4");
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "? 새 계정 이름");

        // 이미 있는 이름 — 입력 칸에 남은 채 이유가 보인다
        await press(view.stdin, "Laptop");
        await press(view.stdin, KEY_ENTER);
        let frame = await waitForFrame(view.lastFrame, "이미 있는 이름: laptop");
        expect(frame).toContain("? 새 계정 이름 laptop");
        expect(peersModule.addPeer).not.toHaveBeenCalled();

        // Ctrl+U 로 비우고 다시
        await press(view.stdin, "\u0015");
        await press(view.stdin, "New-Phone\r");
        frame = await waitForFrame(view.lastFrame, "아무 키나 누르면 돌아갑니다");
        expect(peersModule.addPeer).toHaveBeenCalledWith(SETTINGS, "new-phone");
        expect(frame).toContain("new-phone");

        // 발급 뒤 QR 화면은 목록에서 열었으니 목록으로
        await press(view.stdin, "x");
        await waitForFrame(view.lastFrame, "발급: new-phone → 10.255.0.4");
    });

    it("edits the name like a shell line: arrows, Home, Delete, insert at the cursor", async () => {
        peersModule.addPeer.mockImplementation(async (_settings: Settings, name: string) => {
            return { name: name, address: "10.255.0.4", filePath: path.join(CLIENTS_DIR, `${name}.conf`), clientConf: "[Interface]\n" };
        });
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, "4");
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "? 새 계정 이름");

        // "xphne" → Home · Delete → "phne" → → → · "o" → "phone"; Ctrl+K 같은 조합은 글자로 들어가지 않는다
        await press(view.stdin, "xphne");
        await press(view.stdin, "\u001b[H");
        await press(view.stdin, "\u001b[3~");
        await press(view.stdin, "\u001b[C");
        await press(view.stdin, "\u001b[C");
        await press(view.stdin, "o");
        await press(view.stdin, "\u000b");
        await waitForFrame(view.lastFrame, "? 새 계정 이름 phone");
        await press(view.stdin, KEY_ENTER);
        await waitForFrame(view.lastFrame, "아무 키나 누르면 돌아갑니다");
        expect(peersModule.addPeer).toHaveBeenCalledWith(SETTINGS, "phone");
    });

    it("leaves the name field with Esc, and opens it empty next time", async () => {
        const view = render(<App settings={SETTINGS} endpoint="1.2.3.4:65000" />);
        cleanup = view.unmount;
        await waitForFrame(view.lastFrame, "home-pc");

        await press(view.stdin, "4");
        await press(view.stdin, KEY_ENTER);
        await press(view.stdin, "half");
        await waitForFrame(view.lastFrame, "? 새 계정 이름 half");
        await press(view.stdin, KEY_ESCAPE);
        let frame = await waitForFrame(view.lastFrame, "Esc 끝");
        expect(frame).not.toContain("새 계정 이름");

        await press(view.stdin, KEY_ENTER);
        frame = await waitForFrame(view.lastFrame, "? 새 계정 이름");
        expect(frame).not.toContain("half");
        expect(peersModule.addPeer).not.toHaveBeenCalled();
    });
});
