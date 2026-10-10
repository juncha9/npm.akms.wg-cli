import { render } from "ink";

import type { Settings } from "@/_types";

import { WgCliError } from "@/modules/errors";
import { readEndpoint } from "@/modules/peers";

import { App } from "./app";

// 터미널의 보조 화면 — 들어갈 때 셸 화면을 보관하고, 나올 때 그대로 돌려놓는다(vim · less 와 같은 방식).
const ENTER_ALTERNATE_SCREEN = "\x1b[?1049h\x1b[H";
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l";

/** 전체 화면 TUI. 터미널이 아니면 열지 않는다 — 스크립트에서는 하위 명령을 쓴다. */
export async function runTui(settings: Settings): Promise<void> {
    if(process.stdin.isTTY != true || process.stdout.isTTY != true) {
        throw new WgCliError("화면 모드는 터미널에서만 열립니다 — 스크립트에서는 하위 명령(ls · add · show · rm · forget)을 쓰세요");
    }
    const endpoint = await readEndpoint(settings);

    process.stdout.write(ENTER_ALTERNATE_SCREEN);
    try {
        const instance = render(<App settings={settings} endpoint={endpoint} />);
        await instance.waitUntilExit();
    }
    finally {
        process.stdout.write(LEAVE_ALTERNATE_SCREEN);
    }
}
