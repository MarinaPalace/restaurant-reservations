import { describe, expect, it } from "vitest";
import { getLocalizedText, localizeMenuCatalog } from "@/lib/menu-localization";

describe("menu localization", () => {
  it("falls back to English labels when a translation is missing", () => {
    const course = {
      id: "course-2",
      order: 2,
      name: "Starter",
      description: "A bright and refreshing opening course",
      required: true,
      active: true,
      translations: { fr: { name: "Entrée" } },
      options: [
        {
          id: "option-2",
          courseId: "course-2",
          name: "Citrus Cured Salmon",
          description: "Served with dill and pickled shallot.",
          allergens: ["Fish"],
          active: true,
        },
      ],
    };

    expect(getLocalizedText(course, "fr")).toMatchObject({
      name: "Entrée",
      description: "A bright and refreshing opening course",
    });
  });

  it("supports any additional language and falls back to English when needed", () => {
    const menu = [
      {
        id: "course-1",
        order: 1,
        name: "Amuse Bouche",
        description: "Seasonal bite prepared by the chef",
        required: true,
        active: true,
        translations: {
          fr: { name: "Amuse-Bouche", description: "Bouchée saisonnière" },
          es: { name: "Bocado de bienvenida", description: "Bocado de temporada" },
        },
        options: [
          {
            id: "option-1",
            courseId: "course-1",
            name: "Chef's Selection",
            description: "The kitchen's curated first bite.",
            allergens: ["Gluten"],
            active: true,
            translations: { es: { name: "Selección del chef" } },
          },
        ],
      },
    ];

    const localized = localizeMenuCatalog(menu, "es");
    expect(localized[0].name).toBe("Bocado de bienvenida");
    expect(localized[0].description).toBe("Bocado de temporada");
    expect(localized[0].options[0].name).toBe("Selección del chef");
  });

  it("localizes the full menu for the selected language", () => {
    const menu = [
      {
        id: "course-1",
        order: 1,
        name: "Amuse Bouche",
        description: "Seasonal bite prepared by the chef",
        required: true,
        active: true,
        translations: { fr: { name: "Amuse-Bouche", description: "Bouchée saisonnière" } },
        options: [
          {
            id: "option-1",
            courseId: "course-1",
            name: "Chef's Selection",
            description: "The kitchen's curated first bite.",
            allergens: ["Gluten"],
            active: true,
            translations: { fr: { name: "Sélection du chef" } },
          },
        ],
      },
    ];

    const localized = localizeMenuCatalog(menu, "fr");
    expect(localized[0].name).toBe("Amuse-Bouche");
    expect(localized[0].description).toBe("Bouchée saisonnière");
    expect(localized[0].options[0].name).toBe("Sélection du chef");
  });
});
