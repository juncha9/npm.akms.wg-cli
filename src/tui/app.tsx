import fs from "node:fs";

import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";

import { PEER_NAME_PATTERN } from "@/_defs";
import type { PeerStatus, Settings } from "@/_types";

import { WgCliError } from "@/modules/errors";
import { displayWidth, formatBytes, formatLastSeen, padEnd, renderIssued } from "@/modules/output";
import { addPeer, clientFilePathOf, forgetPeer, listPeers, removePeer, showPeer, UNLEDGERED_NAME } from "@/modules/peers";

import { Select } from "./select";
import type { SelectItem } from "./select";

// 목록을 다시 읽는 간격 — 마지막 연결이 저절로 바뀌어 보이게.
const REFRESH_INTERVAL_MS = 3000;
// WireGuard 는 붙어 있는 동안 2분마다 핸드셰이크를 다시 한다 — 그 안이면 "지금 붙어 있음".
const CONNECTED_WITHIN_SECONDS = 180;
// 메뉴에서 피어 줄의 값 — `peer:<공개키>`. 대장에 없는 피어는 이름이 겹치고, 동작 값("add")과도 섞이지 않게.
const PEER_VALUE_PREFIX = "peer:";

// 한 계정의 하위 메뉴 — 그 메뉴가 연 확인 · QR 화면이 Esc(아니요 · 아무 키)로 돌아갈 곳.
interface PeerMenu {
    peer: PeerStatus;
    hasClientFile: boolean;
}

// 메뉴가 떠 있는 자리. 목록(menu)은 늘 화면 위에 있고, 나머지는 그 아래에 하나씩 뜬다 — view 만 화면 전체.
// 뒤로 가기는 어디서나 정확히 한 단계, 아무것도 바꾸지 않고, 커서는 고른 줄에(@akms/mcp-ssh 0.1.3 과 같은 규칙).
type Mode =
    | { kind: "menu" }
    | { kind: "peer"; menu: PeerMenu; focusValue?: string }
    | { kind: "add"; name: string; cursor: number; error: string | null }
    | { kind: "confirm-remove"; menu: PeerMenu }
    | { kind: "confirm-forget"; menu: PeerMenu }
    | { kind: "view"; body: string; back: Mode };

interface Notice {
    text: string;
    isError: boolean;
}

function messageOf(error: unknown): string {
    if(error instanceof WgCliError) {
        return error.message;
    }
    if(error instanceof Error) {
        return `예상하지 못한 오류: ${error.message}`;
    }
    return `예상하지 못한 오류: ${String(error)}`;
}

export function App(props: { settings: Settings; endpoint: string }) {
    const { settings, endpoint } = props;
    const { exit } = useApp();
    const [peers, setPeers] = useState<PeerStatus[]>([]);
    const [mode, setMode] = useState<Mode>({ kind: "menu" });
    // 메뉴를 다시 그릴 때(QR 화면에서 돌아올 때) 커서를 놓을 자리 — 마지막으로 고른 줄.
    const [focusValue, setFocusValue] = useState<string | undefined>(undefined);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
    const [isBusy, setIsBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const list = await listPeers(settings);
            setPeers(list);
            setNowSeconds(Math.floor(Date.now() / 1000));
        }
        catch(error) {
            setNotice({ text: messageOf(error), isError: true });
        }
    }, [settings]);

    useEffect(() => {
        void refresh();
        const timer = setInterval(() => {
            void refresh();
        }, REFRESH_INTERVAL_MS);
        return () => {
            clearInterval(timer);
        };
    }, [refresh]);

    // 발급 · 회수처럼 대장을 고치는 일 — 도는 동안 키를 막고, 끝나면 한 줄 알림 + 목록 갱신.
    const runTask = async (task: () => Promise<string>): Promise<void> => {
        setIsBusy(true);
        try {
            const text = await task();
            setNotice({ text: text, isError: false });
        }
        catch(error) {
            setNotice({ text: messageOf(error), isError: true });
        }
        finally {
            setIsBusy(false);
            await refresh();
        }
    };

    // 목록 · 하위 메뉴 · 확인은 각 Select 가 키를 받는다. 여기는 QR 화면과 이름 입력만.
    // 이 훅은 늘 켜 둔다 — 켜진 훅이 하나도 없으면 Ink 가 raw 모드를 풀어 처리 중 키가 화면에 찍히고 Ctrl+C 가 그냥 프로세스를 죽인다.
    useInput((input, key) => {
        if(isBusy == true) {
            return;
        }

        if(mode.kind == "view") {
            setMode(mode.back);
            return;
        }

        if(mode.kind != "add") {
            return;
        }
        if(key.escape == true) {
            setMode({ kind: "menu" });
            return;
        }

        // 줄 편집 — mcp-ssh 의 텍스트 칸과 같은 키: ←→, Home · End(Ctrl+A · E), Backspace · Delete, Ctrl+U 비우기.
        const name = mode.name;
        const cursor = mode.cursor;
        let edited: { name: string; cursor: number } | null = null;
        if(key.leftArrow == true) {
            edited = { name: name, cursor: Math.max(0, cursor - 1) };
        }
        else if(key.rightArrow == true) {
            edited = { name: name, cursor: Math.min(name.length, cursor + 1) };
        }
        else if(key.home == true || (key.ctrl == true && input == "a")) {
            edited = { name: name, cursor: 0 };
        }
        else if(key.end == true || (key.ctrl == true && input == "e")) {
            edited = { name: name, cursor: name.length };
        }
        else if(key.backspace == true) {
            edited = { name: name, cursor: cursor };
            if(cursor > 0) {
                edited = { name: name.slice(0, cursor - 1) + name.slice(cursor), cursor: cursor - 1 };
            }
        }
        else if(key.delete == true) {
            edited = { name: name.slice(0, cursor) + name.slice(cursor + 1), cursor: cursor };
        }
        else if(key.ctrl == true && input == "u") {
            edited = { name: "", cursor: 0 };
        }
        if(edited != null) {
            setMode({ kind: "add", name: edited.name, cursor: edited.cursor, error: null });
            return;
        }
        // 다른 Ctrl · Alt 조합은 글자가 아니다 — Ink 는 Ctrl+K 를 input "k" 로 넘긴다.
        if(key.ctrl == true || key.meta == true) {
            return;
        }

        // 빠르게 치거나 붙여 넣으면 여러 글자가 한 번에 온다 — 한 글자씩 커서 자리에 넣고, 안에 Enter 가 있으면 거기서 발급.
        // 대문자는 소문자로 받는다 — 버리면 "Home-PC" 가 "ome-" 로 남는다.
        let typedName = name;
        let typedCursor = cursor;
        let isSubmit = key.return == true;
        for(const character of input) {
            if(character == "\r" || character == "\n") {
                isSubmit = true;
                break;
            }
            const lowered = character.toLowerCase();
            if(/^[a-z0-9-]$/.test(lowered) == true && typedName.length < 32) {
                typedName = typedName.slice(0, typedCursor) + lowered + typedName.slice(typedCursor);
                typedCursor += 1;
            }
        }
        if(isSubmit == false) {
            setMode({ kind: "add", name: typedName, cursor: typedCursor, error: null });
            return;
        }
        // 틀린 이름은 입력 칸에 남겨 둔 채 이유만 보인다 — 처음부터 다시 치지 않게.
        if(typedName == "") {
            setMode({ kind: "add", name: typedName, cursor: typedCursor, error: "이름을 입력하세요 — 그만두려면 Esc" });
            return;
        }
        if(PEER_NAME_PATTERN.test(typedName) == false) {
            setMode({ kind: "add", name: typedName, cursor: typedCursor, error: "소문자 · 숫자로 시작해야 합니다(하이픈은 그 뒤에)" });
            return;
        }
        if(peers.some((peer) => peer.name == typedName) == true) {
            setMode({ kind: "add", name: typedName, cursor: typedCursor, error: `이미 있는 이름: ${typedName} — Ctrl+U 로 비우기` });
            return;
        }
        setMode({ kind: "menu" });
        void runTask(async () => {
            const issued = await addPeer(settings, typedName);
            setMode({ kind: "view", body: renderIssued(issued), back: { kind: "menu" } });
            return `발급: ${issued.name} → ${issued.address}`;
        });
    });

    if(mode.kind == "view") {
        return (
            <Box flexDirection="column">
                <Text>{mode.body}</Text>
                <Text dimColor>아무 키나 누르면 돌아갑니다</Text>
            </Box>
        );
    }

    // 표 — 한글 폭을 세어 열을 맞춘다. 줄 앞 두 칸은 연결 표시(●) 자리.
    const header = ["이름", "주소", "발급", "마지막 연결", "받음 / 보냄"];
    const cells = peers.map((peer) => [
        peer.name,
        peer.allowedIps,
        peer.issuedOn ?? "-",
        formatLastSeen(peer.lastHandshakeAt, nowSeconds),
        `${formatBytes(peer.receivedBytes)} / ${formatBytes(peer.sentBytes)}`,
    ]);
    const widths = header.map((title, column) => Math.max(displayWidth(title), ...cells.map((row) => displayWidth(row[column]))));
    const formatRow = (row: string[]): string => row.map((cell, column) => {
        if(column == row.length - 1) {
            return cell;
        }
        return padEnd(cell, widths[column]);
    }).join("  ");

    // 계정이 곧 메뉴 — 고르면 그 계정의 하위 메뉴, 그 아래로 동작.
    const menuItems: SelectItem<string>[] = [];
    let menuQuestion = "발급한 계정이 없습니다";
    if(peers.length > 0) {
        menuQuestion = `${peers.length}대 — 골라서 관리`;
        menuItems.push({ note: `  ${formatRow(header)}` });
        peers.forEach((peer, index) => {
            let connectedDot = "  ";
            if(peer.lastHandshakeAt != null && nowSeconds - peer.lastHandshakeAt < CONNECTED_WITHIN_SECONDS) {
                connectedDot = "● ";
            }
            let rowColor: string | undefined;
            if(peer.name == UNLEDGERED_NAME) {
                rowColor = "yellow";
            }
            menuItems.push({ value: `${PEER_VALUE_PREFIX}${peer.publicKey}`, label: `${connectedDot}${formatRow(cells[index])}`, color: rowColor });
        });
        menuItems.push({ separator: true });
    }
    menuItems.push({ value: "add", label: "새 계정 발급", hint: "키를 만들어 등록 · 설정 파일 · QR" });
    menuItems.push({ value: "quit", label: "끝" });

    return (
        <Box flexDirection="column">
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
                <Box justifyContent="space-between">
                    <Text bold>WireGuard 계정 — {settings.iface}</Text>
                    <Text dimColor>{endpoint}</Text>
                </Box>
                <Text> </Text>
                <Select
                    question={menuQuestion}
                    items={menuItems}
                    defaultValue={focusValue}
                    cancelValue="quit"
                    isActive={mode.kind == "menu" && isBusy == false}
                    onSelect={(value) => {
                        setFocusValue(value);
                        if(value == "quit") {
                            exit();
                            return;
                        }
                        if(value == "add") {
                            setNotice(null);
                            setMode({ kind: "add", name: "", cursor: 0, error: null });
                            return;
                        }
                        const peer = peers.find((item) => `${PEER_VALUE_PREFIX}${item.publicKey}` == value);
                        if(peer == null) {
                            return;
                        }
                        if(peer.name == UNLEDGERED_NAME) {
                            setNotice({ text: "대장에 없는 피어는 'sudo wg' 로 직접 다룹니다", isError: true });
                            return;
                        }
                        setNotice(null);
                        setMode({ kind: "peer", menu: { peer: peer, hasClientFile: fs.existsSync(clientFilePathOf(settings, peer.name)) } });
                    }}
                />
            </Box>

            {mode.kind == "peer" && (
                <Select
                    question={`${mode.menu.peer.name} — ${mode.menu.peer.allowedIps} · ${mode.menu.peer.issuedOn ?? "-"} 발급`}
                    items={[
                        ...((): SelectItem<string>[] => {
                            if(mode.menu.hasClientFile == false) {
                                return [{ note: "설정 파일은 이미 지웠습니다 — 개인키는 그 기기에만 있습니다" }];
                            }
                            return [
                                { value: "show", label: "설정 · QR 보기", hint: "PC 는 설정 파일, 휴대폰은 QR" },
                                { value: "forget", label: "설정 파일 지우기", hint: "기기에 넣은 뒤 — 개인키만 지우고 등록은 남긴다" },
                            ];
                        })(),
                        { value: "remove", label: "회수", hint: "바로 끊긴다 · 설정 파일도 지운다" },
                        { separator: true },
                        { value: "back", label: "뒤로" },
                    ]}
                    defaultValue={mode.focusValue}
                    cancelValue="back"
                    isActive={isBusy == false}
                    onSelect={(value) => {
                        const menu = mode.menu;
                        const name = menu.peer.name;
                        if(value == "show") {
                            // QR 화면에서 나오면 이 하위 메뉴로 — 기기에 넣고 나서 바로 "설정 파일 지우기" 를 고를 수 있게.
                            void runTask(async () => {
                                const detail = await showPeer(settings, name);
                                if(detail.filePath == null || detail.clientConf == null) {
                                    setMode({ kind: "menu" });
                                    return `${name}: 설정 파일은 이미 지웠습니다 — 개인키는 그 기기에만 있습니다. 다시 필요하면 회수 뒤 새로 발급하세요`;
                                }
                                setMode({
                                    kind: "view",
                                    body: renderIssued({ name: name, filePath: detail.filePath, clientConf: detail.clientConf }),
                                    back: { kind: "peer", menu: menu, focusValue: "show" },
                                });
                                return `${name}: 설정 · QR`;
                            });
                            return;
                        }
                        if(value == "forget") {
                            setMode({ kind: "confirm-forget", menu: menu });
                            return;
                        }
                        if(value == "remove") {
                            setMode({ kind: "confirm-remove", menu: menu });
                            return;
                        }
                        setMode({ kind: "menu" });
                    }}
                />
            )}

            {mode.kind == "add" && (
                <Box flexDirection="column">
                    <Text>
                        <Text color="cyan">? </Text>
                        <Text bold>새 계정 이름 </Text>
                        <Text color="cyan">{mode.name.slice(0, mode.cursor)}</Text>
                        <Text inverse>{mode.name.slice(mode.cursor, mode.cursor + 1).padEnd(1)}</Text>
                        <Text color="cyan">{mode.name.slice(mode.cursor + 1)}</Text>
                    </Text>
                    {mode.error != null && <Text color="red">{"  "}{mode.error}</Text>}
                    <Text dimColor>소문자 · 숫자 · 하이픈, 32자까지 · ←→ 이동 · Ctrl+U 비우기 · Enter 발급 · Esc 뒤로</Text>
                </Box>
            )}

            {/* 되돌릴 수 없는 두 가지 — 커서는 "아니요" 에서 시작한다. 아니요 · Esc 는 그 계정의 하위 메뉴로, 커서는 고른 줄에 */}
            {mode.kind == "confirm-remove" && (
                <Select
                    question={`${mode.menu.peer.name} 을(를) 회수할까요?`}
                    items={[
                        { note: "그 기기는 바로 끊기고 다시 붙지 못합니다" },
                        { value: "no", label: "아니요" },
                        { value: "yes", label: "회수" },
                    ]}
                    defaultValue="no"
                    cancelValue="no"
                    isActive={isBusy == false}
                    onSelect={(value) => {
                        const menu = mode.menu;
                        const name = menu.peer.name;
                        if(value != "yes") {
                            setMode({ kind: "peer", menu: menu, focusValue: "remove" });
                            return;
                        }
                        setMode({ kind: "menu" });
                        void runTask(async () => {
                            const removed = await removePeer(settings, name);
                            return `회수: ${removed.name} (${removed.allowedIps}) — 즉시 끊겼습니다`;
                        });
                    }}
                />
            )}
            {mode.kind == "confirm-forget" && (
                <Select
                    question={`${mode.menu.peer.name} 의 설정 파일(개인키 포함)을 지울까요?`}
                    items={[
                        { note: "등록은 남습니다 — 기기에 넣은 뒤에만 지우세요" },
                        { value: "no", label: "아니요" },
                        { value: "yes", label: "지우기" },
                    ]}
                    defaultValue="no"
                    cancelValue="no"
                    isActive={isBusy == false}
                    onSelect={(value) => {
                        const menu = mode.menu;
                        const name = menu.peer.name;
                        if(value != "yes") {
                            setMode({ kind: "peer", menu: menu, focusValue: "forget" });
                            return;
                        }
                        setMode({ kind: "menu" });
                        void runTask(async () => {
                            const removed = await forgetPeer(settings, name);
                            if(removed == false) {
                                return `${name}: 지울 설정 파일이 없습니다`;
                            }
                            return `${name}: 설정 파일을 지웠습니다(등록은 그대로)`;
                        });
                    }}
                />
            )}

            {mode.kind == "menu" && isBusy == true && <Text dimColor>처리 중…</Text>}
            {mode.kind == "menu" && isBusy == false && notice != null && notice.isError == true && (
                <Text color="red">{notice.text}</Text>
            )}
            {mode.kind == "menu" && isBusy == false && notice != null && notice.isError == false && (
                <Text color="green">{notice.text}</Text>
            )}
        </Box>
    );
}
