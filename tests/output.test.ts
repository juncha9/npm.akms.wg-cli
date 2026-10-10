import { describe, expect, it } from "vitest";

import { buildClientConf } from "@/modules/peers";
import { displayWidth, formatBytes, formatLastSeen, renderPeerTable } from "@/modules/output";

describe("output", () => {
    it("counts Hangul as two columns", () => {
        expect(displayWidth("abc")).toBe(3);
        expect(displayWidth("이름")).toBe(4);
        expect(displayWidth("마지막 연결")).toBe(11);
    });

    it("formats bytes", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(1536)).toBe("1.5 KiB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MiB");
    });

    it("formats the last handshake", () => {
        expect(formatLastSeen(null, 1000)).toBe("없음");
        expect(formatLastSeen(970, 1000)).toBe("30초 전");
        expect(formatLastSeen(1000 - 180, 1000)).toBe("3분 전");
        expect(formatLastSeen(1000 - 7200, 1000)).toBe("2시간 전");
    });

    it("aligns table columns by display width", () => {
        const table = renderPeerTable([
            { name: "home-pc", issuedOn: "2026-10-11", allowedIps: "10.255.0.2/32", publicKey: "k", lastHandshakeAt: null, receivedBytes: 0, sentBytes: 0 },
        ], 0);
        const [header, row] = table.split("\n");
        // 머리줄의 "주소" 와 첫 줄의 주소가 같은 칸에서 시작해야 한다
        const headerColumn = displayWidth(header.slice(0, header.indexOf("주소")));
        const rowColumn = displayWidth(row.slice(0, row.indexOf("10.255.0.2/32")));
        expect(headerColumn).toBe(rowColumn);
    });

    it("builds a client config with the pool after the configured ranges", () => {
        const conf = buildClientConf({
            privateKey: "PRIVATE",
            address: "10.255.0.2",
            server: { publicKey: "SERVER", listenPort: 65000, address: "10.255.0.1", poolCidr: "10.255.0.0/24" },
            endpointHost: "3.36.130.147",
            allowedIps: ["10.0.0.0/16"],
            keepaliveSeconds: 25,
        });
        expect(conf).toBe([
            "[Interface]",
            "PrivateKey = PRIVATE",
            "Address = 10.255.0.2/32",
            "",
            "[Peer]",
            "PublicKey = SERVER",
            "AllowedIPs = 10.0.0.0/16, 10.255.0.0/24",
            "Endpoint = 3.36.130.147:65000",
            "PersistentKeepalive = 25",
            "",
        ].join("\n"));
    });
});
