"""Install the optional 5.3MiB Apache-2.0 OpenCV Zoo pose model.

Run from the project root: python -m tools.download_pose_model
The model is ignored by Git; its license is in docs/pose-model-LICENSE.
"""
import hashlib
from urllib.request import urlopen

from warehouse.visuals import MODEL_URL, model_path


EXPECTED_SHA256 = '9d89c599319a18fb7d2e28451a883476164543182bafca5f09eb2cf767ed2f3f'


def main():
    path = model_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.download')
    try:
        with urlopen(MODEL_URL, timeout=60) as source, temporary.open('wb') as output:
            while block := source.read(1024 * 1024):
                output.write(block)
        if hashlib.sha256(temporary.read_bytes()).hexdigest() != EXPECTED_SHA256:
            raise ValueError('The downloaded model does not match the verified OpenCV Zoo model.')
        temporary.replace(path)
        print('Installed:', path)
    finally:
        temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
