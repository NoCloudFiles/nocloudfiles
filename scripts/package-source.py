"""Package our source and unmodified dependency notices for the public build."""
from pathlib import Path
import zipfile, tarfile

root=Path(__file__).resolve().parents[1]
public=root/'public'
notices=['NoCloudFiles / third-party notices\n\nApplication source: /source.zip (MIT).\n']
for name in ['pdf-lib','@pdf-lib/standard-fonts','@pdf-lib/upng','pako','tslib','heic-to','papaparse','exifreader','@xmldom/xmldom']:
    folder=root/'node_modules'/name
    license_file=next((folder/n for n in ['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','LICENSE-MIT.txt'] if (folder/n).exists()),None)
    if license_file is None:
        raise RuntimeError(f'Missing license: {name}')
    notices.append(f'\n\n=== {name} ===\n'+license_file.read_text())
notices.append('\n\nheic-to 1.4.2: LGPL-3.0-or-later, unmodified npm distribution.\nLocal corresponding distribution and JS source: /heic-to-source.tgz\nBuild instructions and upstream source: https://github.com/hoppergee/heic-to\nlibheif version recorded by this release: 1.21.2\nlibheif source: https://github.com/strukturag/libheif/tree/v1.21.2\nReplace the dependency and rebuild using the supplied package.json and source.\n')
(public/'third-party-notices.txt').write_text(''.join(notices))
with tarfile.open(public/'heic-to-source.tgz','w:gz') as archive:
    archive.add(root/'node_modules/heic-to',arcname='heic-to-1.4.2')
with zipfile.ZipFile(public/'source.zip','w',zipfile.ZIP_DEFLATED) as archive:
    for name in ['src','scripts','tests','public','zh','photos-to-pdf','csv-check','csv-diff','photo-privacy','interleave-pdf','schedule-to-calendar','vcf-select']:
        for p in (root/name).rglob('*'):
            if not p.is_file() or p.name in ['source.zip','heic-to-source.tgz']:
                continue
            archive.write(p,p.relative_to(root))
    for name in ['package.json','package-lock.json','playwright.config.js','playwright.live.config.js','vite.config.js','index.html','wrangler.jsonc','README.md','DESIGN.md','DIRECTION-REVIEW.md','ACCEPTANCE.md','LICENSE','.gitignore']:
        archive.write(root/name,name)
print('Packaged source, dependency distribution and license notices.')
