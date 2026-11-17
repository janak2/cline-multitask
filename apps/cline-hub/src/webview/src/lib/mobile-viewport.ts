type Viewport = Pick<
	VisualViewport,
	"height" | "offsetTop" | "addEventListener" | "removeEventListener"
>;

export function trackMobileViewport(
	viewport: Viewport | null,
	style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
): () => void {
	if (!viewport) return () => {};
	const sync = () => {
		style.setProperty("--hub-viewport-height", `${viewport.height}px`);
		style.setProperty("--hub-viewport-top", `${viewport.offsetTop}px`);
	};
	sync();
	viewport.addEventListener("resize", sync);
	viewport.addEventListener("scroll", sync);
	return () => {
		viewport.removeEventListener("resize", sync);
		viewport.removeEventListener("scroll", sync);
		style.removeProperty("--hub-viewport-height");
		style.removeProperty("--hub-viewport-top");
	};
}
