const DOCUMENT_WINDOW_PLACEMENT_KEY = "nexus.documentWindowPlacement";

type WindowPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function canControlWindow() {
  return typeof window !== "undefined";
}

function getCurrentPlacement(): WindowPlacement {
  return {
    left: Math.max(0, window.screenX || 0),
    top: Math.max(0, window.screenY || 0),
    width: Math.max(320, window.outerWidth || window.innerWidth || 0),
    height: Math.max(480, window.outerHeight || window.innerHeight || 0),
  };
}

function tryMoveAndResize(left: number, top: number, width: number, height: number) {
  try {
    window.moveTo(left, top);
  } catch {
    // Browser tabs may block window placement. Installed/popup windows can allow it.
  }

  try {
    window.resizeTo(width, height);
  } catch {
    // Keep navigation usable even when the browser blocks resizing.
  }
}

export function maximizeDocumentWindow(options: { saveCurrent?: boolean } = {}) {
  if (!canControlWindow()) return;

  if (options.saveCurrent) {
    try {
      sessionStorage.setItem(
        DOCUMENT_WINDOW_PLACEMENT_KEY,
        JSON.stringify(getCurrentPlacement())
      );
    } catch {
      // Storage can be unavailable in private/locked contexts.
    }
  }

  const screenWidth = window.screen?.availWidth || window.screen?.width || window.outerWidth;
  const screenHeight = window.screen?.availHeight || window.screen?.height || window.outerHeight;
  tryMoveAndResize(0, 0, screenWidth, screenHeight);
}

export function restoreDocumentWindowPlacement() {
  if (!canControlWindow()) return;

  let placement: WindowPlacement | null = null;
  try {
    const raw = sessionStorage.getItem(DOCUMENT_WINDOW_PLACEMENT_KEY);
    placement = raw ? (JSON.parse(raw) as WindowPlacement) : null;
  } catch {
    placement = null;
  }

  if (!placement) return;

  tryMoveAndResize(
    placement.left,
    placement.top,
    placement.width,
    placement.height
  );

  try {
    sessionStorage.removeItem(DOCUMENT_WINDOW_PLACEMENT_KEY);
  } catch {
    // Nothing else to do.
  }
}
