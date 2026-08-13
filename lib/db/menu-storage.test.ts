import { describe, expect, it } from "vitest";
import { readMenuCatalogFile, saveMenuCatalogFile } from "@/lib/db/menu-storage";

describe("menu storage", () => {
  it("reads and writes the menu JSON file", async () => {
    const menu = [{
      id: "test-course",
      order: 1,
      name: "Test Course",
      description: "Preview image test",
      required: true,
      active: true,
      imageUrl: "https://example.com/test.jpg",
      options: [{
        id: "test-option",
        courseId: "test-course",
        name: "Test Option",
        description: "Works",
        allergens: ["Dairy"],
        active: true,
        imageUrl: "https://example.com/test-option.jpg",
      }],
    }];

    await saveMenuCatalogFile(menu);
    const loaded = await readMenuCatalogFile();

    expect(loaded[0].imageUrl).toBe("https://example.com/test.jpg");
    expect(loaded[0].options[0].imageUrl).toBe("https://example.com/test-option.jpg");
  });
});
