import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const targets = process.argv.slice(2);
const browsers = targets.length ? targets : ["chrome", "firefox"];

const baseManifest = {
  manifest_version: 3,
  name: "Form Test Auditor",
  description: "Audita formulários de um domínio, rastreia páginas relacionadas e gera relatório.",
  version: "0.1.0",
  permissions: ["activeTab", "debugger", "scripting", "storage", "tabs"],
  host_permissions: ["<all_urls>"],
  action: {
    default_popup: "src/popup.html",
    default_title: "Form Test Auditor"
  }
};

const manifestFor = (browser) => {
  const manifest = {
    ...baseManifest,
    background: browser === "firefox"
      ? { scripts: ["src/background.js"] }
      : { service_worker: "src/background.js" }
  };

  if (browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: "form-test-auditor@meu-dominio.com",
        data_collection_permissions: {
          required: ["none"]
        }
      }
    };
  }

  return manifest;
};

const bundle = async (entry, outfile) => {
  await build({
    entryPoints: [path.join(root, entry)],
    outfile: path.join(root, outfile),
    bundle: true,
    format: "iife",
    target: ["chrome109", "firefox109"],
    logLevel: "info"
  });
};

for (const browser of browsers) {
  if (!["chrome", "firefox"].includes(browser)) {
    throw new Error(`Build desconhecido: ${browser}`);
  }

  const outDir = path.join(root, "dist", browser);
  const srcDir = path.join(outDir, "src");

  await rm(outDir, { recursive: true, force: true });
  await mkdir(srcDir, { recursive: true });
  await cp(path.join(root, "src"), srcDir, {
    recursive: true,
    filter: (source) => !["background.js", "browser-api.js", "popup.js", "report.js"].includes(path.basename(source))
  });

  await bundle("src/background.js", `dist/${browser}/src/background.js`);
  await bundle("src/popup.js", `dist/${browser}/src/popup.js`);
  await bundle("src/report.js", `dist/${browser}/src/report.js`);
  await writeFile(
    path.join(outDir, "manifest.json"),
    `${JSON.stringify(manifestFor(browser), null, 2)}\n`
  );
}
