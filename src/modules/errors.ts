/**
 * 운영자가 고칠 수 있는 실패(없는 이름, 겹치는 이름, sudo 아님 …). CLI 는 이 종류만 메시지 한 줄로 끝내고,
 * 그 밖의 예외는 예상 못 한 오류로 보고 스택까지 남긴다 — `instanceof` 로 가르는 것이 이 클래스의 쓸모다.
 */
export class WgCliError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WgCliError";
    }
}
