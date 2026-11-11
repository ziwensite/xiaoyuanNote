/**
 * Viewport clamping for every floating menu / popover in the app chrome.
 *
 * The popovers used to each roll their own `Math.min(…, innerWidth - w)`:
 * some only clamped horizontally, some only at open time, some used the raw
 * pointer coordinates. On a narrow window, a second monitor, or a taskbar
 * hugging the bottom edge, that meant a menu could hang off the screen with
 * no way to reach the last item.
 *
 * One rule set instead, in viewport coordinates (always `position: fixed`):
 *  - horizontally: anchor at the pointer / trigger's left edge; if it would
 *    cross the right pad, flip so the right edge sits at the trigger's right
 *    (or at the pointer for point anchors); if that still crosses the left
 *    pad, pin to the pad. Wider than the viewport → cap `maxWidth`.
 *  - vertically: prefer below the anchor; if it does not fit, flip above;
 *    if neither side fits, pick the larger side, pin to the pad, and cap
 *    `maxHeight` so the menu scrolls inside itself.
 *
 * Returning `maxHeight` / `maxWidth` is deliberately conservative: we never
 * return a cap that is *larger* than the element's own CSS cap, so a menu that
 * already declares `max-height: 60vh` keeps it.
 *
 * Pure functions, no Vue. `viewportBox()` reads `visualViewport` first (the
 * on-screen keyboard shrinks it) and only then `window.innerWidth/Height`.
 */

export interface ViewportBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Any rect with edges: a DOMRect, a `getBoundingClientRect()` result, etc. */
export interface AnchorBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MenuMetrics {
  width: number;
  height: number;
  /** The element's own CSS max-height, when it declares one. */
  maxHeight?: number;
  /** The element's own CSS max-width, when it declares one. */
  maxWidth?: number;
}

export interface PlaceOptions {
  /** Minimum distance to every viewport edge. Default 8. */
  pad?: number;
  /** Distance between the anchor and the menu. Default 4. */
  gap?: number;
  /** Override the measured viewport (tests, embedded frames). */
  viewport?: ViewportBox;
}

export interface Placement {
  left: number;
  top: number;
  /** Set only when the menu must scroll; never above the CSS cap. */
  maxHeight?: number;
  maxWidth?: number;
}

const DEFAULT_PAD = 8;
const DEFAULT_GAP = 4;

const px = (value: string): number | undefined => {
  if (!value || value === 'none') return undefined;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** The visible viewport. `visualViewport` tracks pinch-zoom and the mobile
 *  keyboard; fall back to the layout viewport when it is unavailable. */
export function viewportBox(): ViewportBox {
  const vv = typeof window === 'undefined' ? null : window.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) {
    return {
      left: vv.offsetLeft,
      top: vv.offsetTop,
      right: vv.offsetLeft + vv.width,
      bottom: vv.offsetTop + vv.height,
    };
  }
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return { left: 0, top: 0, right: w, bottom: h };
}

/** Measure a mounted, teleported menu. `scrollHeight/scrollWidth` is the
 *  unclipped content size; the rect may already be capped by CSS. */
export function measureMenu(el: HTMLElement): MenuMetrics {
  const rect = el.getBoundingClientRect();
  const style = typeof window === 'undefined' ? null : window.getComputedStyle(el);
  return {
    width: Math.max(rect.width, el.scrollWidth),
    height: Math.max(rect.height, el.scrollHeight),
    maxHeight: style ? px(style.maxHeight) : undefined,
    maxWidth: style ? px(style.maxWidth) : undefined,
  };
}

/** Core placement from a rectangle (trigger bounds, cell, selected row). */
export function placeMenu(
  anchor: AnchorBox,
  metrics: MenuMetrics,
  options: PlaceOptions = {},
): Placement {
  const pad = options.pad ?? DEFAULT_PAD;
  const gap = options.gap ?? DEFAULT_GAP;
  const vp = options.viewport ?? viewportBox();
  const minLeft = vp.left + pad;
  const maxRight = vp.right - pad;
  const minTop = vp.top + pad;
  const maxBottom = vp.bottom - pad;
  const availWidth = Math.max(0, maxRight - minLeft);

  /* ------------------------------------------------------------- horizontal */
  let width = metrics.width;
  let maxWidth: number | undefined;
  if (width > availWidth) {
    width = availWidth;
    maxWidth = availWidth < (metrics.maxWidth ?? Number.POSITIVE_INFINITY)
      ? availWidth
      : undefined;
  }

  let left = anchor.left;
  if (left + width > maxRight) {
    // Flip: keep the menu's right edge where the anchor's right edge is.
    const flipped = anchor.right - width;
    left = flipped >= minLeft ? flipped : minLeft;
  }
  if (left < minLeft) left = minLeft;
  // Floating-point / anchor-inside-another-monitor guard.
  if (left + width > maxRight) left = Math.max(minLeft, maxRight - width);

  /* --------------------------------------------------------------- vertical */
  let height = metrics.height;
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - height;
  // A flipped menu must also end above the padded bottom: an anchor below the
  // viewport would otherwise put `above + height` past it.
  const aboveFits = above >= minTop && anchor.top - gap <= maxBottom;
  let top: number;
  let maxHeight: number | undefined;

  if (below + height <= maxBottom && below >= minTop) {
    top = below;
  } else if (aboveFits) {
    top = above;
  } else {
    // Neither side fits. Compare the room each side really has inside the
    // padded viewport (an anchor can itself sit outside it), then pin there
    // and let the menu scroll.
    const spaceBelow = Math.max(0, maxBottom - Math.max(minTop, below));
    const spaceAbove = Math.max(0, Math.min(maxBottom, anchor.top - gap) - minTop);
    if (spaceBelow >= spaceAbove) {
      top = Math.max(minTop, Math.min(below, maxBottom));
      const room = Math.max(0, maxBottom - top);
      if (room < height) {
        height = room;
        maxHeight = room;
      }
    } else {
      // Bottom-align to the anchor's gap, but never above the padded top.
      const edge = Math.min(maxBottom, anchor.top - gap);
      top = Math.max(minTop, edge - height);
      const room = Math.max(0, edge - top);
      if (room < height) {
        height = room;
        maxHeight = room;
      }
    }
  }

  if (maxHeight !== undefined && metrics.maxHeight !== undefined) {
    // The element's CSS already clips tighter than the room we found: leave it.
    maxHeight = maxHeight < metrics.maxHeight ? maxHeight : undefined;
  }
  if (maxWidth !== undefined && metrics.maxWidth !== undefined) {
    maxWidth = maxWidth < metrics.maxWidth ? maxWidth : undefined;
  }

  return { left, top, ...(maxHeight !== undefined ? { maxHeight } : {}), ...(maxWidth !== undefined ? { maxWidth } : {}) };
}

/** Anchor at a pointer position (right-click). */
export function placeMenuFromPoint(
  x: number,
  y: number,
  metrics: MenuMetrics,
  options: PlaceOptions = {},
): Placement {
  return placeMenu({ left: x, top: y, right: x, bottom: y }, metrics, options);
}

/** Anchor at a trigger's bounds (button, row, tab). */
export function placeMenuFromRect(
  rect: AnchorBox,
  metrics: MenuMetrics,
  options: PlaceOptions = {},
): Placement {
  return placeMenu(rect, metrics, options);
}

/**
 * Measure `el` and write the placement straight to its inline style. Use this
 * for menus rendered by hand (no shared `<ContextMenu>`), right after they are
 * mounted and therefore have a measurable box.
 */
export function placeFloating(
  el: HTMLElement,
  anchor: AnchorBox | { x: number; y: number },
  options: PlaceOptions = {},
): Placement {
  const box: AnchorBox =
    'x' in anchor
      ? { left: anchor.x, top: anchor.y, right: anchor.x, bottom: anchor.y }
      : anchor;
  const placement = placeMenu(box, measureMenu(el), options);
  el.style.left = `${placement.left}px`;
  el.style.top = `${placement.top}px`;
  if (placement.maxHeight !== undefined) el.style.maxHeight = `${placement.maxHeight}px`;
  if (placement.maxWidth !== undefined) el.style.maxWidth = `${placement.maxWidth}px`;
  return placement;
}
