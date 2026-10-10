import { describe, expect, it } from "vitest";

import { appendPeer, nextFreeAddress, parsePeers, poolPrefixOf, readInterfaceValue, removePeer } from "@/_libs/ledger";

// 서버(ak_api_01)의 실제 wg0.conf 와 같은 꼴 — 개인키는 이 파일에 없다(PostUp 으로 넣는다).
const SERVER_CONF = `# 관리자 VPN — 집 PC · 노트북이 VPC(10.0.0.0/16) 사설 주소로 바로 붙는다.
# 개인키는 이 파일에 두지 않는다(wg0.key, root 600) — 이 파일은 비밀이 없다.
[Interface]
Address = 10.255.0.1/24
ListenPort = 65000
PostUp = wg set %i private-key /etc/wireguard/%i.key
PostUp = iptables -t nat -A POSTROUTING -s 10.255.0.0/24 -o ens5 -j MASQUERADE
PostDown = iptables -t nat -D POSTROUTING -s 10.255.0.0/24 -o ens5 -j MASQUERADE

# --- 피어 ---
`;

const KEY_A = "kDapyfuJ1EgseW+msaNIyWo22ZDUwa+uo1WcOiOXTB4=";
const KEY_B = "xXtIIaWpbTep6MOZqVMc0Fw1A3JdWoN50+PQlZO2/Ro=";

describe("ledger", () => {
    it("reads interface values", () => {
        expect(readInterfaceValue(SERVER_CONF, "Address")).toBe("10.255.0.1/24");
        expect(readInterfaceValue(SERVER_CONF, "ListenPort")).toBe("65000");
        expect(readInterfaceValue(SERVER_CONF, "Missing")).toBeNull();
    });

    it("has no peers in a fresh server config", () => {
        expect(parsePeers(SERVER_CONF)).toEqual([]);
    });

    it("appends, parses and removes peers back to the original text", () => {
        const withA = appendPeer(SERVER_CONF, { name: "home-pc", issuedOn: "2026-10-11", allowedIps: "10.255.0.2/32", publicKey: KEY_A });
        const withB = appendPeer(withA, { name: "phone", issuedOn: "2026-10-11", allowedIps: "10.255.0.3/32", publicKey: KEY_B });

        expect(parsePeers(withB)).toEqual([
            { name: "home-pc", issuedOn: "2026-10-11", allowedIps: "10.255.0.2/32", publicKey: KEY_A },
            { name: "phone", issuedOn: "2026-10-11", allowedIps: "10.255.0.3/32", publicKey: KEY_B },
        ]);

        // 발급 순서와 다르게 회수해도 원문으로 돌아와야 한다 — 거듭해도 파일이 자라지 않게
        const withoutA = removePeer(withB, "home-pc");
        expect(parsePeers(withoutA).map((peer) => peer.name)).toEqual(["phone"]);
        const restored = removePeer(withoutA, "phone");
        expect(restored).toBe(SERVER_CONF);
    });

    it("does not remove a peer whose name only starts with the target", () => {
        const conf = appendPeer(
            appendPeer(SERVER_CONF, { name: "pc", issuedOn: null, allowedIps: "10.255.0.2/32", publicKey: KEY_A }),
            { name: "pc-2", issuedOn: null, allowedIps: "10.255.0.3/32", publicKey: KEY_B },
        );
        const result = parsePeers(removePeer(conf, "pc"));
        expect(result.map((peer) => peer.name)).toEqual(["pc-2"]);
    });

    it("reads a hand-written peer without a ledger comment as '-'", () => {
        const conf = `${SERVER_CONF}\n[Peer]\nPublicKey = ${KEY_A}\nAllowedIPs = 10.255.0.9/32\n`;
        expect(parsePeers(conf)).toEqual([{ name: "-", issuedOn: null, allowedIps: "10.255.0.9/32", publicKey: KEY_A }]);
    });

    it("gives the lowest free address and skips the server", () => {
        expect(poolPrefixOf("10.255.0.1/24")).toBe("10.255.0");
        expect(nextFreeAddress("10.255.0", [])).toBe("10.255.0.2");
        const peers = [
            { name: "a", issuedOn: null, allowedIps: "10.255.0.2/32", publicKey: KEY_A },
            { name: "b", issuedOn: null, allowedIps: "10.255.0.4/32", publicKey: KEY_B },
        ];
        expect(nextFreeAddress("10.255.0", peers)).toBe("10.255.0.3");
    });

    it("rejects a server address that is not a /24", () => {
        expect(() => poolPrefixOf("10.255.0.1/16")).toThrow();
    });
});
