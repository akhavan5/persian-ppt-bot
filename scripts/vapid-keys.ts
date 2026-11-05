/** ساخت جفت‌کلید VAPID برای اعلان وب (src/webpush.ts). اجرا: npx tsx scripts/vapid-keys.ts
 *  خروجی را در داشبورد کلودفلر (Worker ← Settings ← Variables) بگذار؛ VAPID_PRIVATE_KEY را به‌صورت Secret. */
import { bytesToB64u } from "../src/webpush";

const kp = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const pub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const jwk = (await crypto.subtle.exportKey("jwk", kp.privateKey)) as JsonWebKey;
const d = Uint8Array.from(atob(String(jwk.d).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(jwk.d).length % 4)) % 4)), (c) => c.charCodeAt(0));

console.log(`VAPID_PUBLIC_KEY=${bytesToB64u(pub)}`);
console.log(`VAPID_PRIVATE_KEY=${bytesToB64u(d)}`);
console.log("VAPID_SUBJECT=mailto:info@pptsaz.ir   # اختیاری");
