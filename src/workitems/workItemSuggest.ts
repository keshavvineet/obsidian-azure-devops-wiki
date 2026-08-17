import {
  App,
  Editor,
  EditorPosition,
  EditorSuggest,
  EditorSuggestContext,
  EditorSuggestTriggerInfo,
  TFile,
} from "obsidian";
import type { AdoClient, WorkItemSummary } from "./adoClient";

/**
 * '#'-triggered work-item suggester (FR-6.2, ARCHITECTURE §4.6).
 *
 * Registered unconditionally; `onTrigger` returning null whenever no PAT is configured is what
 * leaves plain '#' typing completely untouched — the requirement is "disabled", not "hidden".
 */
export class WorkItemSuggest extends EditorSuggest<WorkItemSummary> {
  constructor(
    app: App,
    private readonly client: AdoClient,
  ) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    if (!this.client.configured) return null;

    const beforeCursor = editor.getLine(cursor.line).slice(0, cursor.ch);
    // '#' at the start of the line or after whitespace, not inside a word (so 'page#123', a URL
    // fragment, never triggers); the query itself may not contain more whitespace or '#'.
    const match = /(^|\s)#([^\s#]{0,50})$/.exec(beforeCursor);
    if (!match) return null;

    const hashIndex = match.index + match[1].length;
    return { start: { line: cursor.line, ch: hashIndex }, end: cursor, query: match[2] };
  }

  async getSuggestions(context: EditorSuggestContext): Promise<WorkItemSummary[]> {
    try {
      return await this.client.search(context.query);
    } catch {
      // A network hiccup should not spam the editor with an error popover mid-typing.
      return [];
    }
  }

  renderSuggestion(item: WorkItemSummary, el: HTMLElement): void {
    el.addClass("adowiki-workitem-suggestion");
    el.createSpan({ cls: "adowiki-workitem-suggestion__id", text: `#${item.id}` });
    el.createSpan({ cls: "adowiki-workitem-suggestion__title", text: item.title || "(no title)" });
    el.createSpan({
      cls: "adowiki-workitem-suggestion__meta",
      text: [item.type, item.state].filter((part) => part.length > 0).join(" · "),
    });
  }

  selectSuggestion(item: WorkItemSummary): void {
    const context = this.context;
    if (!context) return;

    // A trailing space unless the text already continues with one (SYNTAX-MAPPING §3 row 7):
    // `#456` run straight into the next word renders as plain text in Azure DevOps, and the
    // reference is the whole point of having picked it. A leading space is already guaranteed by
    // the trigger, which only fires at the start of a line or after whitespace.
    const rest = context.editor.getLine(context.end.line).slice(context.end.ch);
    const inserted = `#${item.id}${/^\s/.test(rest) ? "" : " "}`;
    context.editor.replaceRange(inserted, context.start, context.end);
    context.editor.setCursor({ line: context.start.line, ch: context.start.ch + inserted.length });
  }
}
