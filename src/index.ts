// 프로그램에서 쓸 때(다른 도구 · 시험)의 입구. 명령줄은 cli.ts.
export { CLI_VERSION } from "@/_defs";
export type { Settings, PeerEntry, PeerStatus, ServerInfo } from "@/_types";
export { loadSettings, parsePeers, appendPeer, removePeer as removePeerFromLedger, nextFreeAddress, poolPrefixOf, readInterfaceValue } from "@/_libs";
export { WgCliError } from "./modules/errors";
export { listPeers, addPeer, showPeer, removePeer, forgetPeer, buildClientConf, confPathOf, clientFilePathOf } from "./modules/peers";
export type { IssuedPeer, PeerDetail } from "./modules/peers";
export { renderPeerTable, formatBytes, formatLastSeen, displayWidth } from "./modules/output";
