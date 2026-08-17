import { Plugin, setTooltip } from "obsidian";
import type { AdoClient } from "./adoClient";

/**
 * Hover titles for `#123` (FR-6.3, P3).
 *
 * A native tooltip via `setTooltip` rather than a custom popover: the reading-mode chip and the
 * live-preview mark are already decorated elements, so this only needs to attach a label to
 * whichever one the pointer is over, once its work item is known.
 */
export class WorkItemHover {
  private readonly loading = new WeakSet<HTMLElement>();

  constructor(private readonly client: AdoClient) {}

  register(plugin: Plugin): void {
    // No DOM in a headless test run; real Obsidian always has one.
    if (typeof document === "undefined") return;
    plugin.registerDomEvent(document, "mouseover", (event: MouseEvent) => this.handle(event));
  }

  private handle(event: MouseEvent): void {
    if (!this.client.configured) return;

    const target = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(
      ".adowiki-workitem, [data-adowiki-kind='workItem']",
    );
    if (!target || target.hasAttribute("data-adowiki-hover-done") || this.loading.has(target)) return;

    const id = workItemIdOf(target);
    if (id === null) {
      target.setAttribute("data-adowiki-hover-done", "");
      return;
    }

    this.loading.add(target);
    void this.client
      .getById(id)
      .then((summary) => {
        target.setAttribute("data-adowiki-hover-done", "");
        if (summary) {
          setTooltip(target, [summary.title, summary.type, summary.state].join(" · "));
        }
      })
      .finally(() => this.loading.delete(target));
  }
}

/** The id a hovered element refers to, from the live-preview data attribute or the `#123` text. */
function workItemIdOf(el: HTMLElement): number | null {
  const dataId = el.getAttribute("data-adowiki-id");
  if (dataId !== null && /^\d+$/.test(dataId)) return Number(dataId);

  const match = /^#(\d+)$/.exec((el.textContent ?? "").trim());
  return match ? Number(match[1]) : null;
}
