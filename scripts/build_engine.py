"""Build the Python sidecar with its private interpreter; no user Python required."""
import os
import shutil
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
os.chdir(root)
subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
                '--name', 'atlas-engine', '--distpath', 'build/sidecar', '--workpath', 'build/pyinstaller',
                '--specpath', 'build', '--paths', 'engine', '--collect-all', 'pypdf', 'engine/launch.py'], check=True)
target = root / 'build' / 'engine'
if target.exists(): shutil.rmtree(target)
shutil.copytree(root / 'build' / 'sidecar' / 'atlas-engine', target)
binary = target / ('atlas-engine.exe' if os.name == 'nt' else 'atlas-engine')
subprocess.run([str(binary), '--data', str(root / 'build' / 'self-test'), '--self-test'], check=True)
print(f'Engine ready: {binary}')
