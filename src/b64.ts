/** base64 سریع: اگر موتور متد بومی (Uint8Array.fromBase64 / toBase64) داشته باشد از همان استفاده می‌شود (تقریباً بدون CPU)؛
 *  وگرنه حلقه‌ی ساده‌ی بدون callback (بسیار سریع‌تر از Uint8Array.from(atob(..), fn)). برای سقف ۱۰ms CPU پلن رایگان. */
export function b64encode(bytes: Uint8Array): string {
  const native = (bytes as any).toBase64;
  if (typeof native === "function") return native.call(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000) as unknown as number[]);
  return btoa(bin);
}

export function b64decode(s: string): Uint8Array {
  const native = (Uint8Array as any).fromBase64;
  if (typeof native === "function") return native.call(Uint8Array, s);
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
