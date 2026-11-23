export class OverflowPanel {
  constructor(readonly toggle: HTMLButtonElement, private readonly panel: HTMLElement) {
    toggle.addEventListener("click", () => {
      if (panel.hidden) {
        panel.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        panel.querySelector("button")?.focus();
      } else {
        this.close(true);
      }
    });

    panel.addEventListener("click", event => {
      if (event.target instanceof HTMLButtonElement) this.close(true);
    });
    document.addEventListener("pointerdown", event => {
      if (event.target instanceof Node && !panel.contains(event.target) && !toggle.contains(event.target)) {
        this.close();
      }
    });
    document.addEventListener("focusin", event => {
      if (event.target instanceof Node && !panel.contains(event.target) && event.target !== toggle) this.close();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !panel.hidden) {
        event.preventDefault();
        this.close(true);
      }
    });
  }

  close(restoreFocus = false) {
    if (this.panel.hidden) return;
    this.panel.hidden = true;
    this.toggle.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.toggle.focus();
  }
}
