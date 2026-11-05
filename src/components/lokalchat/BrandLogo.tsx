/** Displays the supplied official artwork, framing its surrounding whitespace in CSS. */
export function BrandLogo({ width = 176 }: { width?: number }) {
  return (
    <span className="lc-brand-artwork" style={{ display: "block", position: "relative", overflow: "hidden", width, maxWidth: "100%", aspectRatio: "4 / 1", flexShrink: 0, mixBlendMode: "multiply" }}>
      <img
        src="/lokalchat-official.jpg"
        alt="LokalChat"
        width={1408}
        height={768}
        style={{ position: "absolute", width: "119.322%", maxWidth: "none", height: "auto", left: "-9.746%", top: "-83.051%" }}
      />
    </span>
  );
}
