// 패키지 판 — package.json 과 함께 올린다.
export const CLI_VERSION = "0.0.1";
export const CLI_NAME = "akms-wg";

// 설정 파일 — 없으면 아래 기본값으로 돈다. 서버마다 다른 값(VPC 대역 · 설정 파일 폴더)은 여기에 둔다.
export const DEFAULT_SETTINGS_PATH = "/etc/akms-wg.json";
// 설정 파일 경로를 바꿀 때(시험 · 서버 여러 인터페이스).
export const SETTINGS_PATH_ENV = "AKMS_WG_SETTINGS";

export const DEFAULT_INTERFACE = "wg0";
export const DEFAULT_CONF_DIR = "/etc/wireguard";
export const DEFAULT_KEEPALIVE_SECONDS = 25;
export const DEFAULT_LOCK_PATH = "/run/akms-wg.lock";
// 발급한 클라이언트 설정 파일(개인키 포함)을 두는 곳 — sudo 로 부른 계정의 홈 아래.
export const DEFAULT_CLIENTS_DIR_NAME = ".akms-wg/clients";

// 주소 풀에서 서버가 .1, 클라이언트는 여기서부터 빈 번호.
export const FIRST_CLIENT_HOST = 2;
export const LAST_CLIENT_HOST = 254;

// AWS 인스턴스 메타데이터(IMDSv2) — 서버 공인 주소를 읽어 Endpoint 에 넣는다. AWS 가 아니면 설정의 endpointHost 를 쓴다.
export const IMDS_TOKEN_URL = "http://169.254.169.254/latest/api/token";
export const IMDS_PUBLIC_IPV4_URL = "http://169.254.169.254/latest/meta-data/public-ipv4";
export const IMDS_TIMEOUT_MS = 2000;

// 이름 규칙 — 소문자 · 숫자 · 하이픈, 32자까지. 파일 이름과 대장 주석에 그대로 들어간다.
export const PEER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
// WireGuard 키 — 32바이트 base64, 44자.
export const WG_KEY_PATTERN = /^[A-Za-z0-9+/]{43}=$/;
