const FA = "۰۱۲۳۴۵۶۷۸۹";
const AR = "٠١٢٣٤٥٦٧٨٩";

export const toFa = (s: string) => s.replace(/[0-9]/g, (d) => FA[Number(d)]);

/** ارقام فارسی و عربی → لاتین */
export const toEn = (s: string) =>
  s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)));
