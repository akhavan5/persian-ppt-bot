/** پیش‌نمایش ایمیل خوش‌آمد بدون ارسال: npm run email:preview  →  email-preview.html را در مرورگر باز کنید. */
import { writeFileSync } from "node:fs";
import { welcomeEmail } from "../src/email-welcome";

const { subject, html } = welcomeEmail({} as any, process.argv[2] || "علی رضایی");
writeFileSync("email-preview.html", html);
console.log("subject:", subject, "\nنوشته شد: email-preview.html");
