import { render } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "@/tui/select";
import type { SelectItem } from "@/tui/select";

const KEY_UP = "\u001b[A";
const KEY_DOWN = "\u001b[B";
const KEY_ENTER = "\r";
const KEY_ESCAPE = "\u001b";

const ITEMS: SelectItem<string>[] = [
    { note: "안내 한 줄" },
    { value: "a", label: "가", hint: "첫째" },
    { value: "b", label: "나나나", hint: "둘째" },
    { separator: true },
    { value: "c", label: "끝" },
];

// Ink 는 키를 받고 다음 틱에 다시 그린다 — 쓰고 나서 한 번 쉰다. Esc 는 뒤따르는 바이트를 잠깐 기다린다.
async function press(stdin: { write: (data: string) => void }, key: string): Promise<void> {
    stdin.write(key);
    await new Promise((resolve) => setTimeout(resolve, 60));
}

function pointedLine(frame: string | undefined): string {
    const line = (frame ?? "").split("\n").find((item) => item.startsWith("❯ "));
    return line ?? "";
}

let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

describe("Select", () => {
    it("draws the question, notes, aligned hints and the footer", async () => {
        const view = render(<Select question="고르기" items={ITEMS} cancelValue="c" isActive={true} onSelect={() => {}} />);
        cleanup = view.unmount;

        const frame = view.lastFrame() ?? "";
        expect(frame).toContain("? 고르기");
        expect(frame).toContain("  안내 한 줄");
        // 한 묶음 안의 hint 는 한글 폭으로 맞춘 같은 칸에서 시작한다
        expect(frame).toContain("❯ 가      첫째");
        expect(frame).toContain("  나나나  둘째");
        expect(frame).toContain("Esc 끝");
    });

    it("skips notes and separators and wraps around both ends", async () => {
        const view = render(<Select question="고르기" items={ITEMS} isActive={true} onSelect={() => {}} />);
        cleanup = view.unmount;

        await press(view.stdin, KEY_DOWN);
        expect(pointedLine(view.lastFrame())).toContain("나나나");
        await press(view.stdin, KEY_DOWN);
        expect(pointedLine(view.lastFrame())).toContain("끝");
        await press(view.stdin, KEY_DOWN);
        expect(pointedLine(view.lastFrame())).toContain("가");
        await press(view.stdin, KEY_UP);
        expect(pointedLine(view.lastFrame())).toContain("끝");
        await press(view.stdin, KEY_UP);
        expect(pointedLine(view.lastFrame())).toContain("나나나");
    });

    it("does not move on letter keys", async () => {
        const view = render(<Select question="고르기" items={ITEMS} isActive={true} onSelect={() => {}} />);
        cleanup = view.unmount;

        await press(view.stdin, "j");
        await press(view.stdin, "k");
        expect(pointedLine(view.lastFrame())).toContain("가");
    });

    it("jumps with 1-9, picks with Enter and cancels with Esc", async () => {
        const onSelect = vi.fn();
        const view = render(<Select question="고르기" items={ITEMS} cancelValue="c" isActive={true} onSelect={onSelect} />);
        cleanup = view.unmount;

        await press(view.stdin, "2");
        expect(pointedLine(view.lastFrame())).toContain("나나나");
        await press(view.stdin, "9");
        expect(pointedLine(view.lastFrame())).toContain("나나나");
        await press(view.stdin, KEY_ENTER);
        expect(onSelect).toHaveBeenLastCalledWith("b");
        await press(view.stdin, KEY_ESCAPE);
        expect(onSelect).toHaveBeenLastCalledWith("c");
    });

    it("starts on the default value", async () => {
        const view = render(<Select question="고르기" items={ITEMS} defaultValue="c" isActive={true} onSelect={() => {}} />);
        cleanup = view.unmount;

        expect(pointedLine(view.lastFrame())).toContain("끝");
    });

    it("ignores keys and hides the footer while inactive", async () => {
        const onSelect = vi.fn();
        const view = render(<Select question="고르기" items={ITEMS} cancelValue="c" isActive={false} onSelect={onSelect} />);
        cleanup = view.unmount;

        await press(view.stdin, KEY_DOWN);
        await press(view.stdin, KEY_ENTER);
        expect(pointedLine(view.lastFrame())).toContain("가");
        expect(onSelect).not.toHaveBeenCalled();
        expect(view.lastFrame()).not.toContain("Enter 선택");
    });

    it("keeps the cursor on the same value when the list is reordered", async () => {
        const view = render(<Select question="고르기" items={ITEMS} isActive={true} onSelect={() => {}} />);
        cleanup = view.unmount;

        await press(view.stdin, KEY_DOWN);
        expect(pointedLine(view.lastFrame())).toContain("나나나");

        const reordered: SelectItem<string>[] = [
            { value: "b", label: "나나나", hint: "둘째" },
            { value: "a", label: "가", hint: "첫째" },
            { separator: true },
            { value: "c", label: "끝" },
        ];
        view.rerender(<Select question="고르기" items={reordered} isActive={true} onSelect={() => {}} />);
        await press(view.stdin, "");
        expect(pointedLine(view.lastFrame())).toContain("나나나");
        await press(view.stdin, KEY_DOWN);
        expect(pointedLine(view.lastFrame())).toContain("가");
    });
});
