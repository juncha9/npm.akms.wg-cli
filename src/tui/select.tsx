import { Box, Text, useInput } from "ink";
import { useState } from "react";

import { displayWidth, padEnd } from "@/modules/output";

// 화살표 목록 하나 — @akms/mcp-ssh `setup` 의 Prompter.select 와 같은 손놀림.
// ↑↓ 이동, 끝에서 반대쪽 끝으로 돈다, 1~9 바로 이동, Home · End, Enter 고르기, Esc 는 cancelValue(한 단계 뒤로).
// 글자 키(k · j 같은)로는 움직이지 않는다 — 외울 단축키를 두지 않는다.

// 구분선 길이 상한 — 표 줄처럼 긴 라벨이 있어도 짧게.
const MAX_RULE_WIDTH = 24;

export interface SelectChoice<T extends string> {
    readonly value: T;
    readonly label: string;
    /** 라벨 뒤 흐린 글씨 — 고르면 무엇을 하는지. */
    readonly hint?: string;
    /** 커서가 없을 때의 글자색. 대장에 없는 피어는 "yellow". */
    readonly color?: string;
}

/** 고를 수 없는 줄 — 구분선, 또는 흐린 안내 글(표 머리줄 · 경고). 커서는 건너뛴다. */
export type SelectItem<T extends string> = SelectChoice<T> | { readonly separator: true } | { readonly note: string };

export interface SelectProps<T extends string> {
    readonly question: string;
    readonly items: readonly SelectItem<T>[];
    /** 처음 커서 자리. 없거나 목록에 없으면 첫 선택지. */
    readonly defaultValue?: T;
    /** Esc 가 고르는 값 — 바닥줄에 그 선택지의 라벨이 `Esc 뒤로` 처럼 붙는다. 없으면 Esc 는 아무것도 안 한다. */
    readonly cancelValue?: T;
    /** 다른 질문이 떠 있거나 처리 중이면 false — 키를 받지 않고 바닥줄을 숨긴다. 커서는 그대로 보인다. */
    readonly isActive: boolean;
    readonly onSelect: (value: T) => void;
}

function isChoice<T extends string>(item: SelectItem<T>): item is SelectChoice<T> {
    return "value" in item;
}

export function Select<T extends string>(props: SelectProps<T>) {
    const { question, items, defaultValue, cancelValue, isActive, onSelect } = props;
    // 커서는 자리 번호가 아니라 값으로 — 3초마다 목록을 다시 읽어 줄 순서가 바뀌어도 같은 항목에 머문다.
    const [activeValue, setActiveValue] = useState<T | undefined>(defaultValue);

    const choices = items.filter(isChoice);
    if(choices.length == 0) {
        throw new Error("Select needs at least one choice");
    }
    let activeChoice = choices.find((choice) => choice.value == activeValue);
    if(activeChoice == null) {
        activeChoice = choices[0];
    }
    const activePosition = choices.indexOf(activeChoice);

    useInput((input, key) => {
        if(key.return == true) {
            onSelect(activeChoice.value);
            return;
        }
        if(key.escape == true) {
            if(cancelValue != null) {
                onSelect(cancelValue);
            }
            return;
        }

        let nextPosition = activePosition;
        if(key.upArrow == true) {
            nextPosition = (activePosition - 1 + choices.length) % choices.length;
        }
        else if(key.downArrow == true) {
            nextPosition = (activePosition + 1) % choices.length;
        }
        else if(key.home == true) {
            nextPosition = 0;
        }
        else if(key.end == true) {
            nextPosition = choices.length - 1;
        }
        else if(/^[1-9]$/.test(input) == true && Number(input) <= choices.length) {
            nextPosition = Number(input) - 1;
        }
        else {
            return;
        }
        setActiveValue(choices[nextPosition].value);
    }, { isActive: isActive });

    // 라벨 폭은 구분선 사이 묶음마다 — 긴 표 줄 때문에 "끝" 같은 짧은 동작의 hint 가 멀리 밀리지 않게.
    const labelWidths = items.map(() => 0);
    let groupStart = 0;
    for(let index = 0; index <= items.length; index += 1) {
        if(index < items.length && "separator" in items[index] == false) {
            continue;
        }
        const groupWidth = Math.max(0, ...items.slice(groupStart, index).filter(isChoice).map((choice) => displayWidth(choice.label)));
        for(let member = groupStart; member < index; member += 1) {
            labelWidths[member] = groupWidth;
        }
        groupStart = index + 1;
    }
    const ruleWidth = Math.min(Math.max(...labelWidths), MAX_RULE_WIDTH);

    let footer = "↑↓ 이동 · Enter 선택";
    if(cancelValue != null) {
        const cancelLabel = choices.find((choice) => choice.value == cancelValue)?.label ?? "뒤로";
        footer += ` · Esc ${cancelLabel}`;
    }

    return (
        <Box flexDirection="column">
            <Text>
                <Text color="cyan">? </Text>
                <Text bold>{question}</Text>
            </Text>
            {items.map((item, index) => {
                if("separator" in item) {
                    return <Text key={`separator-${index}`} dimColor>{"  "}{"─".repeat(ruleWidth)}</Text>;
                }
                if("note" in item) {
                    return <Text key={`note-${index}`} dimColor>{"  "}{item.note}</Text>;
                }
                let pointer = "  ";
                let color = item.color;
                if(item == activeChoice) {
                    pointer = "❯ ";
                    color = "cyan";
                }
                let label = item.label;
                let hint = "";
                if(item.hint != null && item.hint != "") {
                    label = padEnd(item.label, labelWidths[index]);
                    hint = `  ${item.hint}`;
                }
                return (
                    <Text key={`choice-${item.value}`}>
                        <Text color={color}>{pointer}{label}</Text>
                        <Text dimColor>{hint}</Text>
                    </Text>
                );
            })}
            {isActive == true && <Text dimColor>{footer}</Text>}
        </Box>
    );
}
