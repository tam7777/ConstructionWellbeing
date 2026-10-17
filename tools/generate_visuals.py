"""Generate optional real pose artifacts: python -m tools.generate_visuals ID ..."""
import argparse
import json
from pathlib import Path

from warehouse.store import Store
from warehouse.visuals import generate_artifact


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('recordings', nargs='+')
    parser.add_argument('--data', type=Path, default=Path('data'))
    parser.add_argument('--fps', type=float, default=6)
    args = parser.parse_args()
    store = Store(args.data / 'warehouse.sqlite')
    for identifier in args.recordings:
        recording = store.get('recordings', identifier)
        if not recording:
            parser.error('Recording not found: ' + identifier)
        tracks = [t for t in store.all('tracks') if t['recording_id'] == identifier]
        result = generate_artifact(args.data, recording, tracks, fps=args.fps)
        print(json.dumps({'recording_id': identifier, 'statistics': result['statistics'],
                          'tracks': [{'id': t['id'], 'samples': len(t['samples'])} for t in result['tracks']]}), flush=True)


if __name__ == '__main__':
    main()
