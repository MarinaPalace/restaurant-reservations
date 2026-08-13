import { promises as fs } from "fs";
import path from "path";

export const MENU_STORAGE_PATH = path.join(process.cwd(), "data", "menu.json");

export async function readMenuCatalogFile() {
  try {
    const raw = await fs.readFile(MENU_STORAGE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveMenuCatalogFile(menu: unknown[]) {
  await fs.mkdir(path.dirname(MENU_STORAGE_PATH), { recursive: true });
  await fs.writeFile(MENU_STORAGE_PATH, JSON.stringify(menu, null, 2), "utf8");
  return menu;
}
