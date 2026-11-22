# PDF shriftlari

PDF hujjatlar (Elchi yorlig‘i, topshirish akti, akt-sverka, qabul va brak aktlari) shu shriftlar bilan yoziladi:
pdfkit’ning standart Helvetica shrifti faqat WinAnsi — kirill harflari va o‘zbekcha ʻ/ʼ buzilib chiqadi.

| Fayl | Shrift |
|---|---|
| `DejaVuSansCondensed.ttf` | DejaVu Sans Condensed 2.37 |
| `DejaVuSansCondensed-Bold.ttf` | DejaVu Sans Condensed Bold 2.37 |

- Manba: https://github.com/dejavu-fonts/dejavu-fonts/releases/tag/version_2_37 (`dejavu-fonts-ttf-2.37.tar.bz2`,
  SHA-256 `fa9ca4d13871dd122f61258a80d01751d603b4d3ee14095d65453b4e846e17d7`).
- Litsenziya: `LICENSE` (Bitstream Vera va Arev litsenziyasi, DejaVu o‘zgarishlari public domain).
- Nega Condensed: kengligi Helvetica bilan deyarli bir xil, shuning uchun 100×60 mm yorliq va akt ustunlari joyida qoladi.
  Oddiy DejaVu Sans 13–20% kengroq.
- Kodda: `registerPdfFonts` (`libs/common/src/pdf/pdf-fonts.ts`). Docker image’ga `Dockerfile` orqali
  `/app/libs/common/assets/fonts` ga ko‘chiriladi.
