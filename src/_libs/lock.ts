import fs from "node:fs";

/**
 * 대장을 고치는 동안 다른 akms-wg 가 끼어들지 않게 — `O_EXCL` 로 잠금 파일을 만든다.
 * 죽은 프로세스가 남긴 파일(안의 PID 가 없음)은 지우고 다시 잡는다. 돌려주는 함수로 푼다.
 */
export function acquireLock(lockPath: string): () => void {
    for(let attempt = 0; attempt < 2; attempt += 1) {
        try {
            const fd = fs.openSync(lockPath, "wx");
            fs.writeSync(fd, String(process.pid));
            fs.closeSync(fd);
            return () => {
                try {
                    fs.unlinkSync(lockPath);
                }
                catch {
                    // 이미 없으면 그만
                }
            };
        }
        catch(error) {
            const code = (error as NodeJS.ErrnoException).code;
            if(code != "EEXIST") {
                throw error;
            }
            const ownerPid = Number(fs.readFileSync(lockPath, "utf8").trim());
            if(Number.isInteger(ownerPid) == true && isProcessAlive(ownerPid) == true) {
                throw new Error(`another akms-wg is running (pid ${ownerPid}) — is a menu open elsewhere?`);
            }
            fs.unlinkSync(lockPath);
        }
    }
    throw new Error(`could not acquire lock: ${lockPath}`);
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
