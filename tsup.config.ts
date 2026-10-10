import { defineConfig } from "tsup";

export default defineConfig([
    // 라이브러리 입구 — 다른 도구 · 시험이 가져다 쓴다. TUI(Ink · React)는 들어가지 않는다.
    {
        entry: ["src/index.ts"],
        format: ["esm", "cjs"],
        target: "node22",
        platform: "node",
        outDir: "lib",
        dts: true,
        sourcemap: true,
        clean: false,
        treeshake: true,
        splitting: false,
        minify: false,
        tsconfig: "./tsconfig.json",
    },
    // 명령줄 — ESM 만(Ink 가 ESM 전용). splitting 을 켜서 TUI 를 따로 떼고 메뉴를 열 때만 불러온다 —
    // `akwg list` 같은 하위 명령이 React · Ink 를 읽지 않게.
    {
        entry: ["src/cli.ts"],
        format: ["esm"],
        target: "node22",
        platform: "node",
        outDir: "lib",
        dts: false,
        sourcemap: true,
        clean: false,
        treeshake: true,
        splitting: true,
        minify: false,
        tsconfig: "./tsconfig.json",
    },
]);
