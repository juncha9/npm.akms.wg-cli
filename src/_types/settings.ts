/** `/etc/akms-wg.json` 의 모양. 모든 항목이 선택이고, 없으면 `_defs` 의 기본값. */
export interface Settings {
    /** WireGuard 인터페이스 이름. 기본 `wg0`. 설정 파일은 `/etc/wireguard/<iface>.conf`. */
    readonly iface: string;
    /** 클라이언트가 터널로 보낼 대역. 기본은 주소 풀 하나뿐이라, VPC 대역(`10.0.0.0/16`)은 여기에 적어야 한다. */
    readonly clientAllowedIps: readonly string[];
    /** Endpoint 의 호스트. 비우면 AWS 메타데이터에서 공인 IPv4 를 읽고, 그것도 없으면 자리 표시만 남긴다. */
    readonly endpointHost: string | null;
    /** 발급한 클라이언트 설정 파일(개인키 포함)을 두는 폴더. 기본은 sudo 로 부른 계정의 `~/.akms-wg/clients`. */
    readonly clientsDir: string | null;
    /** `PersistentKeepalive` 초. 기본 25. */
    readonly keepaliveSeconds: number;
}
