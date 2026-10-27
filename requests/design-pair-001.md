Request design/pair-001. File: apps/web/src/screens/comic/screen.accessibility.test.tsx (test W2-COMIC-T19). Change wanted:

```diff
-    expect(list.style.gridTemplateColumns).toBe("repeat(1, minmax(0, 1fr))");
+    expect(list.className).toContain("comic-grid");
+    expect(list.getAttribute("data-columns")).toBe("1");
     for (const image of screen.getAllByRole("img")) {
-      expect(image.style.width).toBe("100%");
       expect(image.getAttribute("width")).toBe("1024");
...
-    expect(wide.style.gridTemplateColumns).toBe("repeat(2, minmax(0, 1fr))");
+    expect(wide.getAttribute("data-columns")).toBe("2");
```

Then PanelGrid in apps/web/src/screens/comic/panel-grid.tsx drops its two style properties, sets `data-columns={columns}` on the list, and comic.css draws the columns from it (`.comic-grid[data-columns="2"] { grid-template-columns: repeat(2, minmax(0, 1fr)); }`, `.comic-frame img { width: 100%; }`).

Why: the design pass says no inline style attributes anywhere, but T19 reads the column count and the image width from element.style, so PanelGrid still sets those two through React's style prop. The design-pair builder may not change a test's expected value, so this waits for a yes.

Until then: PanelGrid keeps `style={{ gridTemplateColumns }}` on the list and `style={{ width: "100%" }}` on each image, and nothing else inline. React sets these through the style object, which the CSP allows, so the page works; it only breaks the no-inline-style rule.


Integrator answer, 27 Oct 2026: accepted as is for now. React sets these two values through the DOM, which the CSP allows. docs/DESIGN.md lists them as the known exceptions; the test change waits until a later pass touches the comic.
