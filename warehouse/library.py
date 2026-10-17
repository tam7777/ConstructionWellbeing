"""Read-only catalog of the dataset already present on this VM."""
import hashlib
import json
from pathlib import Path


class VideoLibrary:
    def __init__(self, root):
        self.root = Path(root).resolve()

    def items(self):
        checks = {}
        try:
            verification = json.loads((self.root / 'video-verification.json').read_text())
            checks = {c['path']: c.get('media', {}).get('format', {}) for c in verification.get('checks', [])}
        except (OSError, ValueError, KeyError, TypeError):
            pass
        rows = []
        for source in sorted(self.root.rglob('*.mp4')):
            if not source.resolve().is_relative_to(self.root) or not source.is_file():
                continue
            relative = source.relative_to(self.root).as_posix()
            rows.append({'id': hashlib.sha256(relative.encode()).hexdigest()[:24],
                         'filename': source.name, 'relative_path': relative,
                         'collection': 'Construction' if relative.startswith('construction-posture/') else 'Factory',
                         'group': source.parent.name.replace('-', ' '),
                         'duration': float(checks[relative]['duration']) if checks.get(relative, {}).get('duration') else None,
                         'size': source.stat().st_size})
        return rows

    def resolve(self, identifier):
        item = next((r for r in self.items() if r['id'] == identifier), None)
        if not item:
            return None
        source = (self.root / item['relative_path']).resolve()
        return source if source.is_relative_to(self.root) and source.is_file() else None
