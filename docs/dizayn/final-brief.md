# Yakuniy variant «E» — builder brief (2026-11-04)

The owner looked at variants A–D and decided:

> «Tuzilish C variant yoqdi, lekin rang A da yaxshiroq, hamda narx tasdiqlash pagei B da tartibliroq.»

So E is one design that combines three things:

| Layer | Source | What it means |
| --- | --- | --- |
| STRUCTURE | C «Qo‘ldan qo‘lga» | Layouts, sections, composition, component shapes, radii 12–16, spacing, control 44 / row 52 density, signature patterns: the landing's 4:5 media frame, «Eshik qutisi», sticky total bar, «Haq birinchi» offer tiles, the seller's wallet pocket, the operator's bottom call dock, irreversible actions in fixed places |
| COLOUR + TYPE | A «Elchi v2 oilasi» | Only A's tokens (variants.md §1 A.1 table and the A.2 contrast fixes): bg #f4f6fb, surface #ffffff, sunken #f0f3f9, border #e1e6f0, text #101733, muted #4b5575, action #2b50d8 / hover #2443b8, navy #1f2853 with the nav-* tokens, A's status fg/soft pairs (A.8) and A's price-status colours. Font: Manrope only (A.3), A's type scale (A.4) and weights |
| PRICE APPROVAL (S4-a, S4-b) | B «Pochta yorlig‘i» | B's S4 structure (variants.md §2 B.12 S4): «Hisob │ Qaror» columns with the decision column sticky; a basis line under every computed figure; the ticked price ruler with a hatched Qizil zone and open-ended end zones; the S4-b decision block |

## Rules

1. **No C or B colour survives.** That means no paper #f4f1ec, firuza #0b6a70, sand, warm text #1d1b18 or C greys, and no B «WHITE» #f4f8ff, navy-as-text or B stamp colours. Map each colour by ROLE to the A token: page bg → bg; card → surface + 1px border; inset or door box → sunken + border; primary button → action; links → action-fg. Price statuses use A.8.
2. **One font: Manrope.** No Onest, no IBM Plex Sans or Mono. Codes and clocks use Manrope with `font-variant-numeric: tabular-nums`.
3. **Panel shell (S0) is C's structure in A's colours.** That is a 260 px left sidebar on navy #1f2853, with nav-text, nav-muted, nav-active and on-nav exactly as A.1 / A.6, plus a white 64 px top bar with a bottom border.
   - Brand mark: app icon /_blob/930839832f47546af9e2636f4ec663de and the grey placeholder `[brend — EQ-05]` in nav-text.
   - The seller's «Mavjud» wallet pocket sits in the sidebar in nav colours.
   - The shell must be IDENTICAL in E-Operator, E-Sotuvchi and E-Admin-narx (same widths, paddings, item styles, top bar). Only the menu items differ per role (content-spec §1.1–1.3).
4. **Blue only on pressable things** (A's rule). One filled primary button per screen. Status is shown by text + icon + colour; the four price statuses also differ in lightness.
5. **Content is unchanged.** Every label, number and state comes verbatim from content-spec.md, exactly as in the A–D drawings.
6. **The landing keeps C's structure.** It uses A colours and the system stack with optional Manrope, per A.3's landing rule.
7. **Quality bar.** It must look like a finished, shipped product: no gradients, no glass, no left-border cards, no emoji, no text below 12 px, AA contrast. Every file must pass `lint_dc.py`.

## Files (write into the canvas project folder)

| File | Kind | Base |
| --- | --- | --- |
| E-Tizim.dc.html | FIXED 1440 × H | new: the E design-system board. Palette with hex and token names; Manrope type scale; buttons (primary, secondary, ghost, danger; 44 px); inputs (default, focus, error; phone +998); lead/order status chips; the 4 price statuses; card, inset, door box; a table row (52 px); sidebar item states on navy; the price ruler (B) in A colours; a mini price label «tovar 262 000 + yetkazish 30 000 = Jami 292 000» |
| E-Landing.dc.html | FIXED 390 × H | C-Landing.dc.html |
| E-Rahmat.dc.html | FIXED 390 × 844 | C-Rahmat.dc.html |
| E-Operator.dc.html | PAGE 1440 | C-Operator.dc.html |
| E-Sotuvchi.dc.html | PAGE 1440 | C-Sotuvchi.dc.html |
| E-Admin-narx.dc.html | PAGE 1440 | structure from B-Admin-narx.dc.html; shell per rule 3 |
| E-Admin-qaror.dc.html | FIXED | structure from B-Admin-qaror.dc.html; components in E style |
