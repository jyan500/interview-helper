/**
 * Copies the @ricky0123/vad-web runtime assets into public/vad so MicVAD can load them from the app
 * origin (/vad/...). MicVAD's default asset path is "./", which 404s under Vite; without these files
 * the worklet + Silero onnx model + onnxruntime wasm never load and smart-mode VAD silently never fires.
 *
 * Run automatically via the predev/prebuild npm hooks. The copied files are gitignored (public/vad):
 * the onnx wasm alone is ~40MB, so we regenerate from node_modules instead of committing binaries.
 * onnxruntime-web may be nested under vad-web or hoisted — we resolve it from vad-web's own context.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

const vadDir = dirname(require.resolve("@ricky0123/vad-web/package.json"));
const vadDist = join(vadDir, "dist");

// onnxruntime-web blocks require.resolve of its package.json via "exports", and it may be nested under
// vad-web or hoisted to the top-level node_modules — so probe both known dist locations.
const ortDist = [
    join(vadDir, "node_modules", "onnxruntime-web", "dist"), // nested
    join(vadDir, "..", "..", "onnxruntime-web", "dist"),     // hoisted (node_modules/onnxruntime-web)
].find(existsSync);
if (!ortDist) {
    console.error("[copy-vad-assets] onnxruntime-web dist not found; is @ricky0123/vad-web installed?");
    process.exit(1);
}

const outDir = join(process.cwd(), "public", "vad");
mkdirSync(outDir, { recursive: true });

const files = [
    [vadDist, "vad.worklet.bundle.min.js"],
    [vadDist, "silero_vad_v5.onnx"],
    [vadDist, "silero_vad_legacy.onnx"],
    [ortDist, "ort-wasm-simd-threaded.wasm"],
    [ortDist, "ort-wasm-simd-threaded.mjs"],
    [ortDist, "ort-wasm-simd-threaded.jsep.wasm"],
    [ortDist, "ort-wasm-simd-threaded.jsep.mjs"],
];

let copied = 0;
for (const [dir, name] of files) {
    const src = join(dir, name);
    if (!existsSync(src)) {
        console.warn(`[copy-vad-assets] missing ${src} — skipping`);
        continue;
    }
    copyFileSync(src, join(outDir, name));
    copied += 1;
}
console.log(`[copy-vad-assets] copied ${copied}/${files.length} VAD assets -> public/vad`);
