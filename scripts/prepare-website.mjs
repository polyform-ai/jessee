import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const websiteSource = resolve("website");
const websiteBuild = resolve("site-dist");
const showcasePdf = resolve("output/pdf/jessee-explains-jessee.pdf");

rmSync(websiteBuild, { recursive: true, force: true });
cpSync(websiteSource, websiteBuild, { recursive: true });

if (!existsSync(showcasePdf)) {
  throw new Error("Missing output/pdf/jessee-explains-jessee.pdf. Run the visual showcase test before building the website.");
}

mkdirSync(resolve(websiteBuild, "assets"), { recursive: true });
cpSync(showcasePdf, resolve(websiteBuild, "assets/jessee-explains-jessee.pdf"));
