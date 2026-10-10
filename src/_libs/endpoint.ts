import { IMDS_PUBLIC_IPV4_URL, IMDS_TIMEOUT_MS, IMDS_TOKEN_URL } from "@/_defs";

/** AWS 인스턴스 메타데이터(IMDSv2)에서 공인 IPv4. AWS 가 아니거나 공인 주소가 없으면 null — 예외를 던지지 않는다. */
export async function fetchPublicIpv4FromImds(): Promise<string | null> {
    try {
        const tokenResponse = await fetch(IMDS_TOKEN_URL, {
            method: "PUT",
            headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" },
            signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
        });
        if(tokenResponse.ok == false) {
            return null;
        }
        const token = await tokenResponse.text();
        const addressResponse = await fetch(IMDS_PUBLIC_IPV4_URL, {
            headers: { "X-aws-ec2-metadata-token": token },
            signal: AbortSignal.timeout(IMDS_TIMEOUT_MS),
        });
        if(addressResponse.ok == false) {
            return null;
        }
        const address = (await addressResponse.text()).trim();
        if(/^\d+\.\d+\.\d+\.\d+$/.test(address) == false) {
            return null;
        }
        return address;
    }
    catch {
        return null;
    }
}
