export function isActualMobileDevice() {
  if (typeof window === "undefined") return false;

  const navigatorLike = window.navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  const userAgent = navigatorLike.userAgent || "";
  const uaSaysMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      userAgent
    ) || navigatorLike.userAgentData?.mobile === true;

  const coarsePointer =
    window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const noHover = window.matchMedia?.("(hover: none)").matches ?? false;
  const hasTouch =
    "ontouchstart" in window || navigator.maxTouchPoints > 0;

  return uaSaysMobile || (coarsePointer && noHover && hasTouch);
}
