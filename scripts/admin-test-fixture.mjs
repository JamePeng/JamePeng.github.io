import assert from "node:assert/strict";
import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  copyFileSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";

export function adminFixture(t) {
  const tempBase = resolve(tmpdir());
  const root = mkdtempSync(join(tempBase, "blog-admin-"));
  t.after(() => {
    assert(root.startsWith(tempBase + sep + "blog-admin-"));
    rmSync(root, { recursive: true, force: true });
  });
  const project = resolve(import.meta.dirname, "..");
  for (const folder of ["content", "css", "js", "assets"])
    cpSync(join(project, folder), join(root, folder), { recursive: true });
  // Keep editor tests independent of articles added through the live manager.
  const catalogPath = join(root, "content/posts.json");
  const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  writeFileSync(
    catalogPath,
    JSON.stringify(
      catalog.filter((post) => post.slug === "instructions-ffu"),
    ),
  );
  mkdirSync(join(root, "scripts"));
  for (const file of ["build.mjs", "post-metadata.mjs", "about-page.mjs"])
    copyFileSync(join(project, "scripts", file), join(root, "scripts", file));
  cpSync(join(project, "scripts/admin"), join(root, "scripts/admin"), {
    recursive: true,
  });
  return root;
}
