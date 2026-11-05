import { describe, expect, it } from "vitest";
import { applyFormat, toggleTask } from "../../src/frontend/format";

describe("applyFormat", () => {
  it("wraps the selection", () => {
    const edit = applyFormat("bold", "say hi now", 4, 6);
    expect(edit.value).toBe("say **hi** now");
    expect(edit.value.slice(edit.start, edit.end)).toBe("hi");
  });

  it("inserts a placeholder with nothing selected", () => {
    const edit = applyFormat("code", "", 0, 0);
    expect(edit.value).toBe("`code`");
    expect(edit.value.slice(edit.start, edit.end)).toBe("code");
  });

  it("makes a fenced block on its own lines", () => {
    const edit = applyFormat("codeblock", "run: ", 5, 5);
    expect(edit.value).toBe("run: \n```bash\ncommand\n```\n");
  });

  it("adds and removes a line prefix", () => {
    const on = applyFormat("list", "a\nb", 0, 3);
    expect(on.value).toBe("- a\n- b");
    const off = applyFormat("list", on.value, 0, on.value.length);
    expect(off.value).toBe("a\nb");
  });

  it("only touches the lines in the selection", () => {
    const edit = applyFormat("quote", "a\nb\nc", 2, 2);
    expect(edit.value).toBe("a\n> b\nc");
  });
});

describe("toggleTask", () => {
  const text = "- [ ] one\n- [x] two\ntext [ ] not a task\n- [ ] three";

  it("flips only the chosen box", () => {
    expect(toggleTask(text, 0)).toContain("- [x] one");
    expect(toggleTask(text, 1)).toContain("- [ ] two");
    expect(toggleTask(text, 2)).toContain("- [x] three");
    expect(toggleTask(text, 2)).toContain("- [ ] one");
  });
});
