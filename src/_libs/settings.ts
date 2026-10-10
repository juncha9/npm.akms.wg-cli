import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    DEFAULT_CLIENTS_DIR_NAME,
    DEFAULT_INTERFACE,
    DEFAULT_KEEPALIVE_SECONDS,
    DEFAULT_SETTINGS_PATH,
    SETTINGS_PATH_ENV,
} from "@/_defs";
import type { Settings } from "@/_types";

/**
 * 설정 파일(`/etc/akms-wg.json`, 또는 `AKMS_WG_SETTINGS` 가 가리키는 곳)을 읽어 기본값 위에 덮는다. 파일이 없으면 기본값 그대로.
 * 모양이 틀린 값은 기본값으로 두지 않고 바로 멈춘다 — 잘못된 대역으로 클라이언트 설정을 찍어 내는 것보다 낫다.
 */
export function loadSettings(settingsPath?: string): Settings {
    let resolvedPath = DEFAULT_SETTINGS_PATH;
    const envPath = process.env[SETTINGS_PATH_ENV];
    if(envPath != null && envPath != "") {
        resolvedPath = envPath;
    }
    if(settingsPath != null) {
        resolvedPath = settingsPath;
    }

    let raw: Record<string, unknown> = {};
    if(fs.existsSync(resolvedPath) == true) {
        const text = fs.readFileSync(resolvedPath, "utf8");
        const parsed: unknown = JSON.parse(text);
        if(typeof parsed !== "object" || parsed == null || Array.isArray(parsed) == true) {
            throw new Error(`settings must be a JSON object: ${resolvedPath}`);
        }
        raw = parsed as Record<string, unknown>;
    }

    let iface = DEFAULT_INTERFACE;
    if(typeof raw.iface === "string" && raw.iface != "") {
        iface = raw.iface;
    }

    const clientAllowedIps: string[] = [];
    if(raw.clientAllowedIps != null) {
        if(Array.isArray(raw.clientAllowedIps) == false) {
            throw new Error(`clientAllowedIps must be an array of CIDR strings: ${resolvedPath}`);
        }
        for(const item of raw.clientAllowedIps as unknown[]) {
            if(typeof item !== "string" || /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(item) == false) {
                throw new Error(`clientAllowedIps entry is not a CIDR: ${String(item)}`);
            }
            clientAllowedIps.push(item);
        }
    }

    let endpointHost: string | null = null;
    if(typeof raw.endpointHost === "string" && raw.endpointHost != "") {
        endpointHost = raw.endpointHost;
    }

    let clientsDir: string | null = null;
    if(typeof raw.clientsDir === "string" && raw.clientsDir != "") {
        clientsDir = raw.clientsDir;
    }

    let keepaliveSeconds = DEFAULT_KEEPALIVE_SECONDS;
    if(typeof raw.keepaliveSeconds === "number" && raw.keepaliveSeconds > 0) {
        keepaliveSeconds = raw.keepaliveSeconds;
    }

    return {
        iface: iface,
        clientAllowedIps: clientAllowedIps,
        endpointHost: endpointHost,
        clientsDir: clientsDir,
        keepaliveSeconds: keepaliveSeconds,
    };
}

/**
 * 클라이언트 설정 파일을 둘 폴더와 그 주인. 주인은 sudo 로 부른 계정(`SUDO_UID` · `SUDO_GID`) —
 * 개인키가 든 파일을 운영자가 MobaXterm 등으로 내려받을 수 있어야 해서 root 소유로 두지 않는다.
 * 폴더는 설정에 있으면 그것, 없으면 그 계정 홈의 `~/.akms-wg/clients`.
 */
export function resolveClientsDir(settings: Settings): { dir: string; uid: number; gid: number } {
    let uid = 0;
    let gid = 0;
    let home = os.homedir();
    const sudoUid = Number(process.env.SUDO_UID);
    const sudoGid = Number(process.env.SUDO_GID);
    if(Number.isInteger(sudoUid) == true && Number.isInteger(sudoGid) == true && process.env.SUDO_UID != null) {
        uid = sudoUid;
        gid = sudoGid;
        const passwdLine = fs.readFileSync("/etc/passwd", "utf8")
            .split("\n")
            .find((line) => line.split(":")[2] == String(sudoUid));
        if(passwdLine != null) {
            home = passwdLine.split(":")[5];
        }
    }
    else if(typeof process.getuid === "function") {
        uid = process.getuid();
        gid = process.getgid?.() ?? 0;
    }

    let dir = path.join(home, DEFAULT_CLIENTS_DIR_NAME);
    if(settings.clientsDir != null) {
        dir = settings.clientsDir;
    }
    return { dir: dir, uid: uid, gid: gid };
}
