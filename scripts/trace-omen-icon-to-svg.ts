/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import UPNG from 'upng-js';
import imagetracerjs from 'imagetracerjs';

const REPO = path.resolve(__dirname, '..');
const PNG_PATH = path.join(REPO, 'resources', 'omen', 'app-icon.png');
const SVG_PATH = path.join(REPO, 'resources', 'omen', 'app-icon.svg');

function main(): void {
	const force = process.argv.includes('--force');
	if (!force && fs.existsSync(SVG_PATH) && fs.existsSync(PNG_PATH)) {
		const pngM = fs.statSync(PNG_PATH).mtimeMs;
		const svgM = fs.statSync(SVG_PATH).mtimeMs;
		if (pngM <= svgM) {
			console.log(`app-icon.svg is up to date (PNG not newer); pass --force to re-trace`);
			return;
		}
	}
	const buf = fs.readFileSync(PNG_PATH);
	const png = UPNG.decode(buf);
	// UPNG.decode puts the RGBA8 row-major bytes directly on png.data (ctype 6).
	const fullW = png.width;
	const fullH = png.height;
	const fullData = png.data;
	// Downscale 1024 -> 256 (box filter) before tracing: the app icon only ever
	// displays at small sizes, and tracing the full-res, heavily-antialiased
	// source produces a multi-megabyte noise map. A box-averaged 256px image
	// traces into a small, clean, faithful SVG.
	const scale = 4;
	const width = Math.max(1, Math.floor(fullW / scale));
	const height = Math.max(1, Math.floor(fullH / scale));
	const rgba = new Uint8Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < scale; sy++) {
				for (let sx = 0; sx < scale; sx++) {
					const i = (((y * scale + sy) * fullW) + (x * scale + sx)) * 4;
					r += fullData[i]; g += fullData[i + 1]; b += fullData[i + 2]; a += fullData[i + 3];
				}
			}
			const o = (y * width + x) * 4;
			const n = scale * scale;
			rgba[o] = Math.round(r / n); rgba[o + 1] = Math.round(g / n); rgba[o + 2] = Math.round(b / n); rgba[o + 3] = Math.round(a / n);
		}
	}
	console.log(`Tracing ${PNG_PATH} (${fullW}x${fullH} -> downscale ${scale}x -> ${width}x${height}) -> ${SVG_PATH}`);
	const svg = imagetracerjs.imagedataToSVG(
		{ width, height, data: rgba },
		{
			// Logo-tuned: limited palette + smooth, low-count paths.
			ltres: 1.5,
			qtres: 1.5,
			pathomit: 16,
			colorquantcycles: 3,
			numberofcolors: 16,
			colorquantPrefix: 'colorquant',
			malgorithm: 'none',
			blurradius: 0,
			blurdelta: 20,
			strokewidth: 0,
			linefilter: false,
			scale: 1,
			roundcoords: 1,
			viewbox: true,
		}
	);
	fs.writeFileSync(SVG_PATH, svg);
	console.log(`Wrote ${SVG_PATH} (${svg.length} bytes)`);
}

main();
