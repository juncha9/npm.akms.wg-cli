/** 대장(`<iface>.conf` 의 `# peer: <이름> (<날짜>)` 주석이 붙은 `[Peer]`)에서 읽은 한 줄. */
export interface PeerEntry {
    /** 대장 주석의 이름. 주석 없는 `[Peer]` 는 `-`. */
    readonly name: string;
    /** 발급 날짜 `YYYY-MM-DD`. 주석에 없으면 null. */
    readonly issuedOn: string | null;
    /** `AllowedIPs` 값 그대로 — 보통 `10.255.0.2/32`. */
    readonly allowedIps: string;
    readonly publicKey: string;
}

/** 커널(`wg show`)에서 읽은 피어 상태. 등록만 되고 한 번도 안 붙었으면 핸드셰이크가 null. */
export interface PeerStatus extends PeerEntry {
    /** 마지막 핸드셰이크 시각(epoch 초). 없으면 null. */
    readonly lastHandshakeAt: number | null;
    readonly receivedBytes: number;
    readonly sentBytes: number;
}

/** 서버 쪽에서 클라이언트 설정을 만들 때 필요한 것. */
export interface ServerInfo {
    readonly publicKey: string;
    readonly listenPort: number;
    /** 서버 `Address` 의 주소 부분 — `10.255.0.1`. */
    readonly address: string;
    /** 주소 풀 — `10.255.0.0/24`. */
    readonly poolCidr: string;
}
