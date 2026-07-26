# Design QA

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-be8b7b4d-c35d-44c8-815a-31f69c8bec29.png`
- Implementation screenshot: `/private/tmp/investmade-icons-final-good.png`
- Combined comparison: `/private/tmp/investmade-icons-comparison.png`
- Viewport: 426 × 863 CSS px at DPR 2
- Dimensions: source 262 × 1394 px; implementation 426 × 863 px
- State: authenticated mobile Holdings / Positions view with live position rows

## Full-view comparison

The source showed inconsistent marks: WETH and AAPL used large colored circles while AAOI and AMD floated without a shared badge. The revised implementation gives every asset a 48 × 48 circular neutral badge with the same border and a 76% contained image box.

## Focused comparison

Computed styles for WETH, AAOI, AAPL, and AMD are identical: 48 × 48 container, `#eef0f4` background, 1.5 px `#aeb5c0` border, and a 34.2 px image box.

## Comparison history

- Initial P2: mixed backgrounds, corner radii, and optical logo sizes.
- Fix: consolidated presentation under `.asset-mark`, removed symbol-specific backgrounds, and unified the circular radius and image sizing.
- Post-fix: no actionable P0, P1, or P2 icon inconsistencies.

## Required fidelity surfaces

- Typography: unchanged.
- Spacing and layout: unchanged; the fixed icon footprint is preserved.
- Colors and tokens: one shared neutral background and border.
- Image quality: original provider logos retained and contained without distortion.
- Copy and content: unchanged.

## Findings

No actionable P0, P1, or P2 findings remain in the requested icon treatment.

## Follow-up polish

Some source logos contain internal whitespace, so their glyphs vary slightly inside the common badge. This is acceptable P3 polish.

final result: passed

---

# Onboarding Question Header Follow-up

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-05b497da-c73b-400e-abdc-a64e224395d1.png`
- Implementation screenshot: `/private/tmp/investmade-onboarding-question-header.png`
- Combined comparison: `/private/tmp/investmade-onboarding-question-comparison.png`
- Viewport: 852 × 600 CSS px at DPR 1
- Dimensions: source 852 × 184 px; implementation 852 × 600 px. The source crop contains the 138 px header plus blank page below it; comparison normalizes both to 852 px wide.
- State: onboarding question 1 of 5, unauthenticated, light theme

## Full-view comparison

The onboarding-question state now uses a 138 px white header with the oversized investmade.fun wordmark, a 2 px black lower rule, and the outlined Connect wallet action at the right. It follows the source hierarchy and visual weight while preserving the existing question flow below the header.

## Focused comparison

The comparison uses the header region shown in the source and the corresponding region of the browser-rendered question state. The implementation retains the source's black typography, acid-green `fun` mark, white background, rounded wallet control, and dark outlined icon from the existing icon system. No separate focused crop is needed because all requested visual details are readable in the combined 852 px comparison.

## Comparison history

- Initial P2: question screens inherited the compact authenticated-app header, which did not match the supplied onboarding/start-screen header.
- Fix: added `.topbar-onboarding` and applied it whenever navigation is disabled, including question states; adjusted the onboarding page height to account for the 138 px desktop header and preserved compact mobile behavior.
- Post-fix evidence: `/private/tmp/investmade-onboarding-question-comparison.png` shows the large start-screen header in question 1 of 5.

## Required fidelity surfaces

- Typography: brand and CTA use the existing heavy display treatment, with enlarged desktop sizing and compact mobile fallback.
- Spacing and layout: the desktop header is 138 px tall with a full-width lower rule, left-aligned mark, and right-aligned action; the question layout begins immediately beneath it.
- Colors and tokens: white surface, black rule/text, acid-green brand highlight, and a neutral outlined CTA match the source.
- Image quality and asset fidelity: no new image asset was introduced; the existing brand treatment and Lucide wallet icon remain sharp vector assets.
- Copy and content: the CTA remains `Connect wallet`, matching the source; question content is unchanged.

## Findings

No actionable P0, P1, or P2 differences remain for the requested start/question header. The implementation intentionally shows the real onboarding content beneath the header instead of the source's blank crop.

## Implementation Checklist

- [x] Apply the start-screen header style to all navigation-disabled onboarding states.
- [x] Preserve the original compact header on authenticated navigation states.
- [x] Verify the question state in the in-app browser at the reference width.
- [x] Run typecheck and lint.

## Follow-up polish

- [P3] If exact pixel matching is needed for a marketing capture, slightly reduce the desktop CTA horizontal padding; it is visually a little wider than the reference, but does not affect the requested state or usability.

final result: passed

---

# AMZN Square-to-Circle Follow-up

- Source visual truth: `/var/folders/dh/xsqhzxxx59x8k29s9rblhz280000gn/T/codex-clipboard-04fc24ce-e83f-42a0-9c84-f6d61c1f06da.png`
- Implementation screenshot: `/private/tmp/investmade-amzn-icon-after.png`
- Combined comparison: `/private/tmp/investmade-amzn-icon-comparison.png`
- Browser viewport: 1280 × 720 CSS px
- Focused dimensions: source 282 × 154 px; implementation 282 × 154 px
- State: AMZN card-header fixture using the app's production `.asset-mark` CSS and AMZN provider image

## Focused comparison

The source showed the 256 × 256 square AMZN image contained at a smaller size inside
the circle. The revised implementation renders the image at the full inner dimensions
of the 96 × 96 circular mark. `overflow: hidden` and `border-radius: 50%` clip the
square image to the circular boundary without stretching it.

## Comparison history

- Initial P2: visible empty space between square artwork and circular boundary.
- Fix: changed `.asset-mark img` from a contained inset to `width: 100%`,
  `height: 100%`, and `object-fit: cover`.
- Post-fix: no actionable P0, P1, or P2 findings remain.

## Validation

- Computed mark: 96 × 96 px, 50% radius, hidden overflow.
- Computed image: 93 × 93 px inside the 1.5 px border, `object-fit: cover`.
- Image intrinsic dimensions: 256 × 256 px.
- Browser comparison page: two expected images, no console warnings or errors.
- App interaction smoke test: onboarding advanced through four questions normally.
- Project checks: typecheck, lint, 45 tests, and production build passed.

final result: passed
