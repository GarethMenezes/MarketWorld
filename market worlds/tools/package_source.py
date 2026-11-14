"""Package corresponding source without deployment state or recursive archives."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / 'dist/source.zip'
files = [root / name for name in ('README.md', 'LICENSE', 'NOTICES.md')]
for directory in ('dist', 'vendor', 'tests', 'tools'):
    files.extend(p for p in (root / directory).rglob('*')
                 if p.is_file() and p != output and '__pycache__' not in p.parts)
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(set(files)):
        archive.write(path, Path('market-worlds') / path.relative_to(root))
print(f'Packaged {len(set(files))} source files into {output}')
