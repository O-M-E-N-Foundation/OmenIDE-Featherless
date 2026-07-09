/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
#!/usr/bin/env python3
"""Generate Omen IDE platform icons from resources/omen/app-icon.svg or .png."""

from __future__ import annotations
import json
import shutil
import subprocess
import sys
from pathlib import Path

try:
	from PIL import Image
except ImportError:
	print('Pillow is required: pip install pillow', file=sys.stderr)
	sys.exit(1)

REPO = Path(__file__).resolve().parents[1]
SOURCE_SVG = REPO / 'resources' / 'omen' / 'app-icon.svg'
SOURCE_PNG = REPO / 'resources' / 'omen' / 'app-icon.png'
WIN32 = REPO / 'resources' / 'win32'
DARWIN = REPO / 'resources' / 'darwin'
LINUX = REPO / 'resources' / 'linux'
SERVER = REPO / 'resources' / 'server'
WEB = REPO / 'resources' / 'web'
WORKBENCH_MEDIA = REPO / 'src' / 'vs' / 'workbench' / 'browser' / 'media'
GITHUB_AUTH_MEDIA = REPO / 'extensions' / 'github-authentication' / 'media'

FORCE_RASTERIZE = '--rasterize' in sys.argv  # kept for backward compatibility; tracing now handles PNG-newer-than-SVG

PNG_SIZES = {
	WIN32 / 'code_70x70.png': 70,
	WIN32 / 'code_150x150.png': 150,
	WIN32 / 'code_256.png': 256,
	LINUX / 'code.png': 512,
	SERVER / 'code-192.png': 192,
	SERVER / 'code-512.png': 512,
	WORKBENCH_MEDIA / 'code-icon.png': 256,
	GITHUB_AUTH_MEDIA / 'code-icon.png': 256,
}


def rasterize_svg() -> None:
	cmd = [
		'npx', '--yes', '@resvg/resvg-js-cli',
		str(SOURCE_SVG), str(SOURCE_PNG),
		'--fit-width', '1024', '--fit-height', '1024',
	]
	print('>', ' '.join(cmd))
	subprocess.run(cmd, cwd=REPO, check=True)


def sync_svg_copies() -> None:
	for dest in (WORKBENCH_MEDIA / 'code-icon.svg', GITHUB_AUTH_MEDIA / 'code-icon.svg'):
		dest.parent.mkdir(parents=True, exist_ok=True)
		shutil.copy2(SOURCE_SVG, dest)
		print(f'Synced {dest.relative_to(REPO)}')


def resize_png(source: Image.Image, size: int, dest: Path) -> None:
	dest.parent.mkdir(parents=True, exist_ok=True)
	resized = source.resize((size, size), Image.Resampling.LANCZOS)
	resized.save(dest, format='PNG', optimize=True)


def run_png2icons() -> None:
	for out, fmt in (
		('resources/win32/code', '-icowe'),
		('resources/darwin/code', '-icns'),
	):
		cmd = ['npx', '--yes', 'png2icons', str(SOURCE_PNG), str(REPO / out), fmt, '-i']
		print('>', ' '.join(cmd))
		subprocess.run(cmd, cwd=REPO, check=True)
	# Multi-size favicon.ico (16/32/48/64/128/256) for the web/server PWA.
	favicon_cmd = ['npx', '--yes', 'png2icons', str(SOURCE_PNG), str(SERVER / 'favicon'), '-icowe', '-i']
	print('>', ' '.join(favicon_cmd))
	subprocess.run(favicon_cmd, cwd=REPO, check=True)


def write_xpm(source: Image.Image, dest: Path, size: int = 48, max_colors: int = 85) -> None:
	"""Write a palette-quantized XPM (RPM package references code.xpm as Icon:)."""
	small = source.convert('RGB').resize((size, size), Image.Resampling.LANCZOS)
	quant = small.quantize(colors=max_colors, method=Image.MEDIANCUT)
	palette = quant.getpalette() or []
	pix = quant.load()
	# 2-char ASCII codes (XPM forbids space, backslash, and doublequote in codes/names).
	pool = '._-0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+*():;<>?@[]^{}~'
	codes = [f'{a}{b}' for a in pool for b in pool if a not in ' "\\\\' and b not in ' "\\\\']
	if len(codes) < max_colors:
		raise RuntimeError(f'need {max_colors} XPM codes, only generated {len(codes)}')
	lines = ['/* XPM */', 'static char * omenide_xpm[] = {', f'"{size} {size} {max_colors} 2",']
	for idx in range(max_colors):
		r, g, b = palette[idx * 3], palette[idx * 3 + 1], palette[idx * 3 + 2]
		lines.append(f'"{codes[idx]} c #{r:02x}{g:02x}{b:02x}",')
	for y in range(size):
		row = ''.join(codes[pix[x, y]] for x in range(size))
		lines.append(f'"{row}",')
	lines.append('};')
	dest.parent.mkdir(parents=True, exist_ok=True)
	dest.write_text('\n'.join(lines) + '\n', encoding='ascii')


def update_manifest_brand(manifest: Path, name: str = 'Omen IDE', short_name: str = 'Omen IDE') -> None:
	"""Omen-rebrand the PWA manifest name/short_name (icon paths are untouched)."""
	if not manifest.is_file():
		return
	try:
		data = json.loads(manifest.read_text(encoding='utf-8'))
		data['name'] = name
		data['short_name'] = short_name
		manifest.write_text(json.dumps(data, indent='\t') + '\n', encoding='utf-8')
		print(f'Updated brand strings in {manifest.relative_to(REPO)}')
	except Exception as e:
		print(f'WARN: could not update {manifest}: {e}', file=sys.stderr)


def main() -> None:
	if not SOURCE_SVG.is_file():
		print(f'Missing source icon: {SOURCE_SVG}', file=sys.stderr)
		sys.exit(1)

	# When the PNG is newer than the SVG, re-trace the PNG into the SVG so the in-source
	# .svg brand slots (titlebar, github-auth) track the raster source. The tracer is
	# imagetracerjs + upng-js (see scripts/trace-omen-icon-to-svg.ts). Pass --no-trace to skip.
	if '--no-trace' not in sys.argv and SOURCE_PNG.is_file() and SOURCE_SVG.stat().st_mtime < SOURCE_PNG.stat().st_mtime:
		trace_cmd = ['npx', 'tsx', str(REPO / 'scripts' / 'trace-omen-icon-to-svg.ts')]
		print('>', ' '.join(trace_cmd))
		subprocess.run(trace_cmd, cwd=REPO, check=True)

	print(f'Using source: {SOURCE_SVG}')
	sync_svg_copies()
	image = Image.open(SOURCE_PNG).convert('RGBA')

	for dest, size in PNG_SIZES.items():
		resize_png(image, size, dest)
		print(f'Wrote {dest.relative_to(REPO)} ({size}x{size})')

	run_png2icons()

	shutil.copy2(WIN32 / 'code.ico', WIN32 / 'code-omenide.ico')
	shutil.copy2(DARWIN / 'code.icns', DARWIN / 'disk.icns')
	print('Synced code-omenide.ico and disk.icns')

	# Mirror server icons into resources/web (if that folder exists alongside the build).
	if WEB.is_dir():
		for fn in ('favicon.ico', 'code-192.png', 'code-512.png'):
			shutil.copy2(SERVER / fn, WEB / fn)
		print(f'Synced {WEB.relative_to(REPO)} web icons')

	# Linux RPM .xpm (referenced by build/gulpfile.vscode.linux.ts).
	write_xpm(image, LINUX / 'rpm' / 'code.xpm')
	print(f'Wrote {LINUX.relative_to(REPO)}/rpm/code.xpm (48x48)')

	# PWA manifest brand strings.
	update_manifest_brand(SERVER / 'manifest.json')
	if WEB.is_dir():
		update_manifest_brand(WEB / 'manifest.json')


if __name__ == '__main__':
	main()
