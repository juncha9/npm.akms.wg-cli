import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";

import { PEER_NAME_PATTERN } from "@/_defs";
import type { PeerStatus, Settings } from "@/_types";

import { WgCliError } from "@/modules/errors";
import { displayWidth, formatBytes, formatLastSeen, padEnd, renderIssued } from "@/modules/output";
import { addPeer, forgetPeer, listPeers, removePeer, showPeer, UNLEDGERED_NAME } from "@/modules/peers";

// 목록을 다시 읽는 간격 — 마지막 연결이 저절로 바뀌어 보이게.
const REFRESH_INTERVAL_MS = 3000;
// WireGuard 는 붙어 있는 동안 2분마다 핸드셰이크를 다시 한다 — 그 안이면 "지금 붙어 있음".
const CONNECTED_WITHIN_SECONDS = 180;

type Mode =
    | { kind: "list" }
    | { kind: "add"; name: string }
    | { kind: "confirm-remove"; name: string }
    | { kind: "confirm-forget"; name: string }
    | { kind: "view"; body: string };

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
    const [selected, setSelected] = useState(0);
    const [mode, setMode] = useState<Mode>({ kind: "list" });
    const [notice, setNotice] = useState<Notice | null>(null);
    const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
    const [isBusy, setIsBusy] = useState(false);

    const refresh = useCallback(async () => {
        try {
            const list = await listPeers(settings);
            setPeers(list);
            setNowSeconds(Math.floor(Date.now() / 1000));
            setSelected((index) => Math.min(index, Math.max(0, list.length - 1)));
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

    const current = peers[selected];
    const currentName = current?.name;
    const canActOnCurrent = current != null && current.name != UNLEDGERED_NAME;

    useInput((input, key) => {
        if(isBusy == true) {
            return;
        }

        if(mode.kind == "view") {
            setMode({ kind: "list" });
            return;
        }

        if(mode.kind == "add") {
            if(key.escape == true) {
                setMode({ kind: "list" });
                return;
            }
            if(key.backspace == true || key.delete == true) {
                setMode({ kind: "add", name: mode.name.slice(0, -1) });
                return;
            }
            // 빠르게 치거나 붙여 넣으면 여러 글자가 한 번에 온다 — 한 글자씩 받고, 안에 Enter 가 있으면 거기서 발급
            let typedName = mode.name;
            let isSubmit = key.return == true;
            for(const character of input) {
                if(character == "\r" || character == "\n") {
                    isSubmit = true;
                    break;
                }
                if(/^[a-z0-9-]$/.test(character) == true && typedName.length < 32) {
                    typedName += character;
                }
            }
            if(isSubmit == false) {
                setMode({ kind: "add", name: typedName });
                return;
            }
            setMode({ kind: "list" });
            if(typedName == "") {
                return;
            }
            if(PEER_NAME_PATTERN.test(typedName) == false) {
                setNotice({ text: `이름은 소문자 · 숫자 · 하이픈, 32자까지: ${typedName}`, isError: true });
                return;
            }
            void runTask(async () => {
                const issued = await addPeer(settings, typedName);
                setMode({ kind: "view", body: renderIssued(issued) });
                return `발급: ${issued.name} → ${issued.address}`;
            });
            return;
        }

        if(mode.kind == "confirm-remove") {
            const name = mode.name;
            setMode({ kind: "list" });
            if(input == "y") {
                void runTask(async () => {
                    const removed = await removePeer(settings, name);
                    return `회수: ${removed.name} (${removed.allowedIps}) — 즉시 끊겼습니다`;
                });
            }
            return;
        }

        if(mode.kind == "confirm-forget") {
            const name = mode.name;
            setMode({ kind: "list" });
            if(input == "y") {
                void runTask(async () => {
                    const removed = await forgetPeer(settings, name);
                    if(removed == false) {
                        return `${name}: 지울 설정 파일이 없습니다`;
                    }
                    return `${name}: 설정 파일을 지웠습니다(등록은 그대로)`;
                });
            }
            return;
        }

        // 목록 화면
        if(input == "q" || key.escape == true) {
            exit();
            return;
        }
        if(key.upArrow == true || input == "k") {
            setSelected((index) => Math.max(0, index - 1));
            return;
        }
        if(key.downArrow == true || input == "j") {
            setSelected((index) => Math.min(Math.max(0, peers.length - 1), index + 1));
            return;
        }
        if(input == "a") {
            setNotice(null);
            setMode({ kind: "add", name: "" });
            return;
        }
        if(input == "r") {
            void refresh();
            return;
        }
        if(key.return == true || input == "d" || input == "x") {
            if(canActOnCurrent == false || currentName == null) {
                setNotice({ text: "고를 수 있는 계정이 없습니다(대장에 없는 피어는 'sudo wg' 로 직접 다룹니다)", isError: true });
                return;
            }
            if(key.return == true) {
                void runTask(async () => {
                    const detail = await showPeer(settings, currentName);
                    if(detail.filePath == null || detail.clientConf == null) {
                        return `${currentName}: 설정 파일은 이미 지웠습니다 — 개인키는 그 기기에만 있습니다. 다시 필요하면 회수 뒤 새로 발급하세요`;
                    }
                    setMode({ kind: "view", body: renderIssued({ name: currentName, filePath: detail.filePath, clientConf: detail.clientConf }) });
                    return `${currentName}: 설정 · QR`;
                });
                return;
            }
            if(input == "d") {
                setMode({ kind: "confirm-remove", name: currentName });
                return;
            }
            setMode({ kind: "confirm-forget", name: currentName });
        }
    });

    if(mode.kind == "view") {
        return (
            <Box flexDirection="column">
                <Text>{mode.body}</Text>
                <Text dimColor>아무 키나 누르면 목록으로 돌아갑니다</Text>
            </Box>
        );
    }

    // 표 — 한글 폭을 세어 열을 맞춘다
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

    return (
        <Box flexDirection="column">
            <Box borderStyle="round" borderColor="cyan" flexDirection="column" paddingX={1}>
                <Box justifyContent="space-between">
                    <Text bold>WireGuard 계정 — {settings.iface} · {peers.length}대</Text>
                    <Text dimColor>{endpoint}</Text>
                </Box>
                <Text> </Text>
                <Text dimColor>{"    "}{formatRow(header)}</Text>
                {peers.length == 0 && (
                    <Text dimColor>{"    "}발급한 계정이 없습니다 — a 로 발급</Text>
                )}
                {peers.map((peer, index) => {
                    const isSelected = index == selected;
                    const isConnected = peer.lastHandshakeAt != null && nowSeconds - peer.lastHandshakeAt < CONNECTED_WITHIN_SECONDS;
                    let marker = "  ";
                    if(isSelected == true) {
                        marker = "▸ ";
                    }
                    let connectedDot = "  ";
                    if(isConnected == true) {
                        connectedDot = "● ";
                    }
                    let rowColor: string | undefined;
                    if(peer.name == UNLEDGERED_NAME) {
                        rowColor = "yellow";
                    }
                    return (
                        <Box key={peer.publicKey}>
                            <Text color="cyan">{marker}</Text>
                            <Text color="green">{connectedDot}</Text>
                            <Text bold={isSelected} inverse={isSelected} color={rowColor}>
                                {formatRow(cells[index])}
                            </Text>
                        </Box>
                    );
                })}
            </Box>

            {mode.kind == "add" && (
                <Text>새 계정 이름: <Text color="cyan">{mode.name}</Text>▏ <Text dimColor>(소문자 · 숫자 · 하이픈, Enter 발급 · Esc 취소)</Text></Text>
            )}
            {mode.kind == "confirm-remove" && (
                <Text color="yellow">{mode.name} 을(를) 회수할까요? 그 기기는 바로 끊기고 다시 붙지 못합니다. y / n</Text>
            )}
            {mode.kind == "confirm-forget" && (
                <Text color="yellow">{mode.name} 의 설정 파일(개인키 포함)을 지울까요? 등록은 남습니다 — 기기에 넣은 뒤에만. y / n</Text>
            )}
            {mode.kind == "list" && isBusy == true && <Text dimColor>처리 중…</Text>}
            {mode.kind == "list" && isBusy == false && notice != null && notice.isError == true && (
                <Text color="red">{notice.text}</Text>
            )}
            {mode.kind == "list" && isBusy == false && notice != null && notice.isError == false && (
                <Text color="green">{notice.text}</Text>
            )}
            {mode.kind == "list" && (
                <Text dimColor>↑↓ 고르기   a 발급   Enter 설정·QR   d 회수   x 설정파일 지우기   r 새로고침   q 끝</Text>
            )}
        </Box>
    );
}
