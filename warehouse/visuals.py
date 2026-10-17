"""Optional 2D pose evidence from OpenCV Zoo's MediaPipe pose ONNX model.

Output coordinates are pixels in the normalized recording. They are neither
metric 3D coordinates nor health/ergonomic measurements. Input/output conventions
follow OpenCV Zoo's Apache-2.0 mp_pose.py; see docs/pose-model-LICENSE and
https://github.com/opencv/opencv_zoo/tree/main/models/pose_estimation_mediapipe.
This implementation uses existing YOLO/ByteTrack boxes, without MediaPipe's
auxiliary rotation landmarks, so crops are padded and axis-aligned.
"""
import json
import math
import os
import time
from pathlib import Path

import cv2
import numpy as np


MODEL = 'OpenCV Zoo MediaPipe pose (2023mar, CPU)'
MODEL_FILE = 'pose_estimation_mediapipe_2023mar.onnx'
MODEL_URL = ('https://media.githubusercontent.com/media/opencv/opencv_zoo/main/'
             'models/pose_estimation_mediapipe/' + MODEL_FILE)
POSE_THRESHOLD = .6
JOINT_THRESHOLD = .55
DEFAULT_FPS = 6


def model_path():
    return Path(os.environ.get('WAREHOUSE_POSE_MODEL',
                Path(__file__).resolve().parent.parent / 'models' / MODEL_FILE))


def artifact_path(root, recording):
    # The source's parent is already a recording-specific data directory.
    base = Path(root).resolve()
    directory = (base / recording['media_path']).resolve().parent
    if not directory.is_relative_to(base):
        raise ValueError('Recording media is outside the data directory.')
    return directory / 'visuals.json'


def empty_artifact(recording, status='missing', message=None):
    result = {'recording_id': recording['id'], 'status': status, 'model': MODEL,
              'width': recording['width'], 'height': recording['height'],
              'fps': DEFAULT_FPS, 'keypoint_format': 'mediapipe33', 'tracks': [],
              'coordinate_space': 'normalized_video_pixels',
              'pose_threshold': POSE_THRESHOLD, 'joint_threshold': JOINT_THRESHOLD,
              'crop_method': 'padded_axis_aligned_track_bbox',
              'limitations': '2D model estimates; occlusion, small people and oblique views reduce reliability. No metric or health measurements.'}
    if message:
        result['message'] = message
    return result


def save_artifact(root, recording, artifact):
    path = artifact_path(root, recording)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix('.json.tmp')
    temporary.write_text(json.dumps(artifact, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(path)
    return artifact


def read_artifact(root, recording):
    try:
        return json.loads(artifact_path(root, recording).read_text(encoding='utf-8'))
    except FileNotFoundError:
        return empty_artifact(recording)
    except (ValueError, OSError):
        return empty_artifact(recording, 'failed', 'Pose artifact could not be read. Generate it again.')


def crop_person(frame, bbox, padding=1.2):
    """Return NHWC RGB input and the invertible square crop (x, y, side)."""
    x1, y1, x2, y2 = map(float, bbox)
    if not all(math.isfinite(v) for v in (x1, y1, x2, y2)) or x2 <= x1 or y2 <= y1:
        raise ValueError('Invalid tracking box.')
    side = max(x2 - x1, y2 - y1) * padding
    left, top = (x1 + x2 - side) / 2, (y1 + y2 - side) / 2
    # Mapping source->256 square preserves aspect ratio and pads at image edges.
    scale = 256 / side
    affine = np.array([[scale, 0, -left * scale], [0, scale, -top * scale]], dtype=np.float32)
    crop = cv2.warpAffine(frame, affine, (256, 256), flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    blob = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    return blob[None], (left, top, side)


def decode_pose(outputs, crop, bbox, width, height, pose_threshold=POSE_THRESHOLD):
    """Decode the official 39x5 landmark tensor; publish the first33 only."""
    landmarks = next((np.asarray(v).reshape(-1, 5) for v in outputs if np.asarray(v).size == 195), None)
    score = next((float(np.asarray(v).reshape(-1)[0]) for v in outputs if np.asarray(v).size == 1), 0.)
    if landmarks is None or not math.isfinite(score) or score < pose_threshold:
        return None
    landmarks = landmarks[:33].copy()
    if not np.isfinite(landmarks).all():
        return None
    left, top, side = crop
    xy = landmarks[:, :2] * (side / 256) + [left, top]
    # The model returns visibility and presence logits, not probabilities.
    probabilities = 1 / (1 + np.exp(-np.clip(landmarks[:, 3:5], -60, 60)))
    confidence = np.minimum(probabilities[:, 0], probabilities[:, 1])
    inside = (xy[:, 0] >= 0) & (xy[:, 0] < width) & (xy[:, 1] >= 0) & (xy[:, 1] < height)
    confidence[~inside] = 0
    # Reject crops whose torso belongs to somebody outside this track's box.
    x1, y1, x2, y2 = bbox
    torso = np.array([11, 12, 23, 24])
    torso_inside = ((xy[torso, 0] >= x1) & (xy[torso, 0] <= x2)
                    & (xy[torso, 1] >= y1) & (xy[torso, 1] <= y2))
    if np.count_nonzero((confidence[torso] >= JOINT_THRESHOLD) & torso_inside) < 3:
        return None
    if np.count_nonzero(confidence[11:] >= JOINT_THRESHOLD) < 6:
        return None
    keypoints = [[round(float(point[0]), 2), round(float(point[1]), 2), round(float(c), 4)]
                 for point, c in zip(xy, confidence)]
    return {'keypoints': keypoints, 'confidence': round(score, 4)}


class PoseEstimator:
    def __init__(self, path=None):
        path = Path(path or model_path())
        if not path.is_file():
            raise ValueError('Optional pose model is not installed. Download the official OpenCV Zoo model into models/.')
        cv2.setNumThreads(2)
        self.net = cv2.dnn.readNet(str(path))
        self.net.setPreferableBackend(cv2.dnn.DNN_BACKEND_OPENCV)
        self.net.setPreferableTarget(cv2.dnn.DNN_TARGET_CPU)
        self.outputs = self.net.getUnconnectedOutLayersNames()

    def infer(self, frame, bbox):
        blob, crop = crop_person(frame, bbox)
        self.net.setInput(blob)
        return decode_pose(self.net.forward(self.outputs), crop, bbox, frame.shape[1], frame.shape[0])


def generate_artifact(root, recording, tracks, fps=DEFAULT_FPS, estimator=None, progress=None):
    """Bound CPU work to 6fps/max4 tracks/30s, with no inferred gap filling."""
    started = time.monotonic()
    fps = min(8, max(1, float(fps)))
    artifact = empty_artifact(recording, 'ready')
    artifact['fps'] = fps
    estimator = estimator or PoseEstimator()
    source = Path(root) / recording['media_path']
    capture = cv2.VideoCapture(str(source))
    if not capture.isOpened():
        raise ValueError('The normalized recording could not be opened for pose inference.')
    frame_fps = float(recording['fps'])
    stride = max(1, round(frame_fps / fps))
    artifact['fps'] = round(frame_fps / stride, 3)
    schedule = {}
    for track in tracks[:4]:
        result = {'id': track['id'], 'track_id': track['track_id'], 'samples': []}
        artifact['tracks'].append(result)
        # Use observed tracking frames only; never synthesize a missing box.
        previous = -stride
        for sample in track.get('samples', []):
            index = int(sample['frame'])
            if index / frame_fps >= 30:
                break
            if index - previous < stride or float(sample.get('confidence', 0)) < .35:
                continue
            previous = index
            schedule.setdefault(index, []).append((result, sample))
    attempted = 0
    decoded = 0
    try:
        # Sequential decoding avoids repeated expensive seeks in H.264 footage.
        for index in range(max(schedule, default=-1) + 1):
            if index not in schedule:
                if not capture.grab():
                    break
                continue
            ok, frame = capture.read()
            if not ok:
                break
            decoded += 1
            for track, sample in schedule[index]:
                attempted += 1
                pose = estimator.infer(frame, sample['bbox'])
                if pose is not None:
                    track['samples'].append(dict(time=round(index / frame_fps, 4), **pose))
            if progress and decoded % 12 == 0:
                progress(min(95, 5 + round(index / max(1, max(schedule)) * 90)))
    finally:
        capture.release()
    accepted = sum(len(t['samples']) for t in artifact['tracks'])
    artifact['statistics'] = {'attempted': attempted, 'accepted': accepted,
                              'elapsed_seconds': round(time.monotonic() - started, 2)}
    artifact['duration_processed'] = min(float(recording['duration']), 30.)
    if not accepted:
        artifact['message'] = 'No pose passed confidence and track-association checks. Person boxes remain available.'
    return save_artifact(root, recording, artifact)
