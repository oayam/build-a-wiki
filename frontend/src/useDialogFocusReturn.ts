import React from "react";

const POINTER_FOCUS_ATTRIBUTE = "data-pointer-focus-return";
const FOCUS_VISIBLE_SELECTOR = ":focus-visible";
const KEYDOWN_EVENT = "keydown";
const BLUR_EVENT = "blur";
const TRIGGER_SELECTOR = "button.tree-create, button.directory-create";
const INPUT_SOURCE_ATTRIBUTE = "data-dialog-input-source";
const INPUT_SOURCE = { KEYBOARD: "keyboard", POINTER: "pointer" } as const;
const KEYBOARD_CLICK_DETAIL = 0;

export function captureDialogTrigger(event: React.MouseEvent<HTMLElement>) {
  if (!(event.target instanceof Element)) return;
  const trigger = event.target.closest(TRIGGER_SELECTOR);
  trigger?.setAttribute(
    INPUT_SOURCE_ATTRIBUTE,
    event.detail === KEYBOARD_CLICK_DETAIL
      ? INPUT_SOURCE.KEYBOARD
      : INPUT_SOURCE.POINTER,
  );
}

// Capture the opener before the dialog input takes focus. Typing into that input
// must not change whether the original pointer trigger needs a keyboard ring.
export function useDialogFocusReturn() {
  const [opener] = React.useState(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return undefined;
    return {
      element,
      keyboard: element.hasAttribute(INPUT_SOURCE_ATTRIBUTE)
        ? element.getAttribute(INPUT_SOURCE_ATTRIBUTE) === INPUT_SOURCE.KEYBOARD
        : element.matches(FOCUS_VISIBLE_SELECTOR) &&
          !element.hasAttribute(POINTER_FOCUS_ATTRIBUTE),
    };
  });
  return () => {
    if (!opener?.element.isConnected) return;
    const { element, keyboard } = opener;
    if (!keyboard) {
      const clear = () => {
        element.removeAttribute(POINTER_FOCUS_ATTRIBUTE);
        element.removeEventListener(KEYDOWN_EVENT, clear);
        element.removeEventListener(BLUR_EVENT, clear);
      };
      element.setAttribute(POINTER_FOCUS_ATTRIBUTE, "");
      element.addEventListener(KEYDOWN_EVENT, clear);
      element.addEventListener(BLUR_EVENT, clear);
    }
    element.focus({ preventScroll: true });
  };
}
